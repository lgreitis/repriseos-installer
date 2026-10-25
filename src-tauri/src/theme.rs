use reprise_bundle::{sha256, VerifiedBundle, MAX_ASSET_BYTES};
use serde::Deserialize;
use std::ops::Range;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
const HEADER: usize = 48;

pub(crate) struct Themes {
    pub default: Vec<u8>,
    pub dark: Vec<u8>,
}

#[derive(Deserialize)]
struct Input {
    bytes: usize,
    sha256: String,
}

#[derive(Deserialize)]
struct Bitmap {
    offset: usize,
    bytes: usize,
    data_offset: usize,
    crc32: u32,
}

#[derive(Deserialize)]
struct Catalog {
    schema: u32,
    input: Input,
    bitmaps: Vec<Bitmap>,
}

struct Record {
    asset: usize,
    data: Range<usize>,
}

struct Pack<'a> {
    bytes: &'a [u8],
    catalog: Catalog,
    records: Vec<Record>,
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in data {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}

fn word(data: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(data[at..at + 4].try_into().unwrap())
}

fn parse<'a>(bytes: &'a [u8], raw_catalog: &[u8]) -> Result<Pack<'a>> {
    if bytes.len() < HEADER || bytes.len() > MAX_ASSET_BYTES || &bytes[..4] != b"RTH3" {
        return Err("Unsupported Dark Mode file".into());
    }
    let catalog_hash: String = bytes[4..36].iter().map(|b| format!("{b:02x}")).collect();
    if sha256(raw_catalog) != catalog_hash || raw_catalog.len() > MAX_ASSET_BYTES {
        return Err("Dark Mode catalog fingerprint mismatch".into());
    }
    let catalog: Catalog = serde_json::from_slice(raw_catalog)?;
    let count = word(bytes, 36) as usize;
    if catalog.schema != 1
        || count == 0
        || count > catalog.bitmaps.len()
        || catalog.bitmaps.len() > 4096
        || word(bytes, 40) as usize != bytes.len() - HEADER
        || word(bytes, 44) != crc32(&bytes[HEADER..])
    {
        return Err("Invalid Dark Mode file".into());
    }
    let mut records = Vec::with_capacity(count);
    let mut position = HEADER;
    for _ in 0..count {
        let header = bytes
            .get(position..position + 12)
            .ok_or("Truncated theme record")?;
        let index = word(header, 0) as usize;
        let offset = word(header, 4) as usize;
        let length = word(header, 8) as usize;
        let asset = catalog
            .bitmaps
            .get(index)
            .ok_or("Invalid theme bitmap index")?;
        if records.last().is_some_and(|r: &Record| r.asset >= index)
            || offset != asset.data_offset
            || length == 0
            || asset.bytes.checked_sub(offset) != Some(length)
        {
            return Err("Invalid theme bitmap bounds".into());
        }
        position += 12;
        let end = position
            .checked_add(length)
            .filter(|end| *end <= bytes.len())
            .ok_or("Truncated theme pixels")?;
        records.push(Record {
            asset: index,
            data: position..end,
        });
        position = (end + 3) & !3;
    }
    if position != bytes.len() {
        return Err("Unexpected bytes after theme records".into());
    }
    Ok(Pack {
        bytes,
        catalog,
        records,
    })
}

fn load(bundle: &VerifiedBundle) -> Result<Option<Pack<'_>>> {
    let files = &bundle
        .manifest()
        .components
        .get("osos")
        .ok_or("Missing OSOS component")?
        .files;
    match (
        files.contains_key("dark_mode"),
        files.contains_key("bitmap_catalog"),
    ) {
        (false, false) => Ok(None),
        (true, true) => Ok(Some(parse(
            bundle.file("osos", "dark_mode")?,
            bundle.file("osos", "bitmap_catalog")?,
        )?)),
        _ => Err("Package is missing Dark Mode artwork or its catalog".into()),
    }
}

pub(crate) fn disk_bytes(bundle: &VerifiedBundle) -> Result<u32> {
    Ok(load(bundle)?.map_or(0, |pack| (pack.bytes.len() * 2) as u32))
}

impl Pack<'_> {
    fn restore(&self, osos: &[u8]) -> Result<Vec<u8>> {
        if osos.len() != self.catalog.input.bytes || sha256(osos) != self.catalog.input.sha256 {
            return Err("Theme restoration requires the original Apple firmware".into());
        }
        let mut light = self.bytes.to_vec();
        for record in &self.records {
            let asset = &self.catalog.bitmaps[record.asset];
            let end = asset
                .offset
                .checked_add(asset.bytes)
                .ok_or("Bitmap range overflow")?;
            let original = osos
                .get(asset.offset..end)
                .ok_or("Bitmap outside Apple firmware")?;
            if crc32(original) != asset.crc32 {
                return Err("Stock bitmap checksum mismatch".into());
            }
            light[record.data.clone()].copy_from_slice(&original[asset.data_offset..]);
        }
        let crc = crc32(&light[HEADER..]);
        light[44..48].copy_from_slice(&crc.to_le_bytes());
        Ok(light)
    }
}

pub(crate) fn assemble(bundle: &VerifiedBundle, osos: &[u8]) -> Result<Option<Themes>> {
    load(bundle)?
        .map(|pack| {
            Ok(Themes {
                default: pack.restore(osos)?,
                dark: pack.bytes.to_vec(),
            })
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stock_pack_comes_from_verified_firmware_and_invalid_packs_are_rejected() {
        let original: Vec<u8> = (0..42).collect();
        let catalog = serde_json::to_vec(&serde_json::json!({
            "schema": 1, "input": {"bytes": original.len(), "sha256": sha256(&original)},
            "bitmaps": [{"offset": 0, "bytes": 42, "data_offset": 32, "crc32": crc32(&original)}]
        }))
        .unwrap();
        let mut dark = b"RTH3".to_vec();
        let hash = sha256(&catalog);
        dark.extend(
            (0..64)
                .step_by(2)
                .map(|i| u8::from_str_radix(&hash[i..i + 2], 16).unwrap()),
        );
        for word in [1u32, 24, 0, 0, 32, 10] {
            dark.extend_from_slice(&word.to_le_bytes());
        }
        dark.extend_from_slice(&[99; 10]);
        dark.extend_from_slice(&[0; 2]);
        let crc = crc32(&dark[HEADER..]);
        dark[44..48].copy_from_slice(&crc.to_le_bytes());
        let pack = parse(&dark, &catalog).unwrap();
        let light = pack.restore(&original).unwrap();
        assert_eq!(&light[60..70], &original[32..]);
        assert_eq!(&dark[60..70], &[99; 10]);
        assert!(parse(&light, &catalog).is_ok());
        assert!(pack.restore(&[0; 42]).is_err());
        assert!(parse(&dark[..dark.len() - 1], &catalog).is_err());
        assert!(parse(&dark, b"{}").is_err());
        dark[60] ^= 1;
        assert!(parse(&dark, &catalog).is_err());
        dark[60] ^= 1;
        dark[52..56].copy_from_slice(&0u32.to_le_bytes());
        let crc = crc32(&dark[HEADER..]);
        dark[44..48].copy_from_slice(&crc.to_le_bytes());
        assert!(parse(&dark, &catalog).is_err());
    }
}
