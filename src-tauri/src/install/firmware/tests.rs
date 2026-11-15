use super::*;

#[test]
fn partials_are_named_after_their_ciphertext() {
    let cache = Path::new("/cache");
    let a = partial_path(cache, "osos-2.0.5", b"first image");
    let b = partial_path(cache, "osos-2.0.5", b"second image");
    assert_ne!(a, b);
    assert_eq!(a, partial_path(cache, "osos-2.0.5", b"first image"));
    let name = a.file_name().unwrap().to_string_lossy().into_owned();
    assert!(name.starts_with("osos-2.0.5.") && name.ends_with(".partial"));
    assert_eq!(name.len(), "osos-2.0.5.".len() + 16 + ".partial".len());
}

#[test]
fn only_whole_blocks_within_the_image_resume() {
    let ciphertext = [0u8; 64];
    assert!(resumable(&[0; 16], &ciphertext));
    assert!(resumable(&[0; 64], &ciphertext));
    assert!(!resumable(&[], &ciphertext));
    assert!(!resumable(&[0; 17], &ciphertext));
    assert!(!resumable(&[0; 80], &ciphertext));
}

#[test]
fn a_resumed_run_takes_the_preceding_block_as_iv() {
    let ciphertext: Vec<u8> = (0..64).collect();
    assert_eq!(resume_iv(&ciphertext, 0), None);
    let iv: Vec<u8> = (16..32).collect();
    assert_eq!(
        resume_iv(&ciphertext, 32).unwrap().as_slice(),
        iv.as_slice()
    );
}

#[test]
fn partials_of_other_images_are_removed_and_this_one_kept() {
    let cache = tempfile::tempdir().unwrap();
    let partial = partial_path(cache.path(), "osos-2.0.5", b"current");
    let other = partial_path(cache.path(), "osos-2.0.5", b"older");
    let other_temporary = other.with_extension("partial.tmp");
    let loader = partial_path(cache.path(), "aupd-2.0.5", b"loader");
    let image = cache.path().join("osos-2.0.5.bin");
    for path in [&partial, &other, &other_temporary, &loader, &image] {
        fs::write(path, b"data").unwrap();
    }
    remove_other_partials(&partial).unwrap();
    assert!(partial.exists() && loader.exists() && image.exists());
    assert!(!other.exists() && !other_temporary.exists());
}

#[test]
fn a_failed_save_keeps_the_plaintext_and_a_bad_image_drops_it() {
    let cache = tempfile::tempdir().unwrap();
    let partial = partial_path(cache.path(), "osos-2.0.5", b"image");
    // A directory in the image's place makes the save fail.
    let blocked = cache.path().join("blocked");
    fs::create_dir(&blocked).unwrap();
    assert!(save_or_keep(&blocked, b"image", &partial, &[7; 32]).is_err());
    assert_eq!(fs::read(&partial).unwrap(), vec![7; 32]);

    // A file left in the image's place by a failed save goes, so the next
    // attempt does not trust it.
    let image = cache.path().join("osos-2.0.5.bin");
    fs::write(&image, b"half").unwrap();
    assert!(save_or_keep(&image, b"image", &partial, &[7; 32]).is_err());
    assert!(!image.exists());
    assert_eq!(fs::read(&partial).unwrap(), vec![7; 32]);

    save_or_keep(&image, b"image", &partial, &[7; 32]).unwrap();
    assert!(image.exists() && !partial.exists());

    save_partial(&partial, &[7; 32]).unwrap();
    let invalid: std::result::Result<(), &str> = Err("bad image");
    assert!(discard_if_invalid(&partial, invalid).is_err());
    assert!(!partial.exists());
}
