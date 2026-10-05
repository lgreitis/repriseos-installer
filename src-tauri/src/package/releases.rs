use serde::Deserialize;
use std::time::Duration;

#[derive(Deserialize)]
struct Release {
    draft: bool,
    published_at: Option<String>,
    assets: Vec<ReleaseAsset>,
}

#[derive(Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
}

fn newest_manifest(releases: Vec<Release>, target: &str) -> Result<String, String> {
    let release = releases
        .into_iter()
        .filter(|release| !release.draft && release.published_at.is_some())
        .max_by(|a, b| a.published_at.cmp(&b.published_at))
        .ok_or(
            "No RepriseOS release has been published yet. Choose a local package to continue.",
        )?;
    let name = format!("{target}-manifest.json");
    release
        .assets
        .into_iter()
        .find(|asset| asset.name == name)
        .map(|asset| asset.browser_download_url)
        .ok_or_else(|| format!("The newest RepriseOS release has no package for {target}. Choose a matching local package."))
}

pub(super) fn latest_manifest_url(target: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(concat!("repriseos-installer/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut releases = Vec::new();
    for page in 1.. {
        let response = client
            .get("https://api.github.com/repos/lgreitis/osos-lab/releases")
            .header("Accept", "application/vnd.github+json")
            .query(&[("per_page", 100), ("page", page)])
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(|e| format!("Could not check RepriseOS releases: {e}"))?;
        let batch: Vec<Release> = serde_json::from_reader(response).map_err(|e| e.to_string())?;
        let last_page = batch.len() < 100;
        releases.extend(batch);
        if last_page {
            break;
        }
    }
    newest_manifest(releases, target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn newest_published_release_includes_prereleases_and_skips_drafts() {
        let release = |tag: &str, date: &str, draft: bool, prerelease: bool| {
            json!({
                "draft": draft,
                "prerelease": prerelease,
                "published_at": date,
                "assets": [{
                    "name": "classic7g-2.0.4-manifest.json",
                    "browser_download_url": format!("https://github.com/lgreitis/osos-lab/releases/download/{tag}/classic7g-2.0.4-manifest.json")
                }]
            })
        };
        let releases = serde_json::from_value(json!([
            release("v0.2.0", "2026-09-28T00:00:00Z", true, false),
            release("v0.1.0", "2026-09-25T00:00:00Z", false, false),
            release("v0.2.0-alpha.1", "2026-09-26T00:00:00Z", false, true)
        ]))
        .unwrap();
        assert_eq!(
            newest_manifest(releases, "classic7g-2.0.4").unwrap(),
            "https://github.com/lgreitis/osos-lab/releases/download/v0.2.0-alpha.1/classic7g-2.0.4-manifest.json"
        );
        assert!(newest_manifest(Vec::new(), "classic7g-2.0.4").is_err());
    }
    #[test]
    fn selects_each_target_without_falling_back_to_another_package_or_release() {
        let release = |date, names: &[&str]| {
            json!({
                "draft": false, "published_at": date,
                "assets": names.iter().map(|name| json!({
                    "name": name, "browser_download_url": format!("https://example.com/{name}")
                })).collect::<Vec<_>>()
            })
        };
        let both = release(
            "2026-10-05",
            &[
                "classic6g-reva-2.0.1-manifest.json",
                "classic7g-2.0.4-manifest.json",
            ],
        );
        for target in reprise_device::targets::all() {
            let releases = serde_json::from_value(json!([both])).unwrap();
            assert_eq!(
                newest_manifest(releases, &target.target).unwrap(),
                format!("https://example.com/{}-manifest.json", target.target)
            );
        }
        let releases = serde_json::from_value(json!([
            both,
            release(
                "2026-10-06",
                &["classic7g-2.0.4-manifest.json", "manifest.json"]
            )
        ]))
        .unwrap();
        assert!(newest_manifest(releases, "classic6g-reva-2.0.1").is_err());
    }
}
