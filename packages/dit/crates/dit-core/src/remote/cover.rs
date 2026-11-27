//! Uploading a local image file and pinning it as the cover of a track, collection or project.

use std::fmt;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::multipart::{MultipartError, upload_file};
use super::{Remote, RemoteError};

/// Which entity receives the uploaded cover image.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "id")]
pub enum CoverTarget {
    Track(i64),
    Collection(i64),
    Project(i64),
}

impl CoverTarget {
    pub fn kind_name(self) -> &'static str {
        match self {
            CoverTarget::Track(_) => "track",
            CoverTarget::Collection(_) => "collection",
            CoverTarget::Project(_) => "project",
        }
    }

    pub fn id(self) -> i64 {
        match self {
            CoverTarget::Track(id) | CoverTarget::Collection(id) | CoverTarget::Project(id) => id,
        }
    }
}

/// The stored image metadata returned by `PUT /api/images/parent/:kind/:parentId`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverImage {
    pub id: i64,
    pub asset_path: String,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub accent_hue: Option<f64>,
    #[serde(default)]
    pub accent_chroma: Option<f64>,
}

/// Why setting a cover image failed.
#[derive(Debug)]
pub enum CoverError {
    Local(String),
    Remote(RemoteError),
}

impl fmt::Display for CoverError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoverError::Local(message) => f.write_str(message),
            CoverError::Remote(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for CoverError {}

impl From<RemoteError> for CoverError {
    fn from(error: RemoteError) -> Self {
        CoverError::Remote(error)
    }
}

impl From<MultipartError> for CoverError {
    fn from(error: MultipartError) -> Self {
        match error {
            MultipartError::Local(message) => CoverError::Local(message),
            MultipartError::Remote(error) => CoverError::Remote(error),
        }
    }
}

/// The image MIME type inferred from the file extension.
pub fn image_content_type(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase());
    match ext.as_deref() {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("avif") => "image/avif",
        _ => "application/octet-stream",
    }
}

/// Resolves the project that owns `target`.
fn project_id_of(remote: &Remote, target: CoverTarget) -> Result<i64, RemoteError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Owned {
        project_id: i64,
    }
    match target {
        CoverTarget::Project(id) => Ok(id),
        CoverTarget::Track(id) => Ok(remote.get::<Owned>(&format!("/tracks/{id}"))?.project_id),
        CoverTarget::Collection(id) => Ok(remote
            .get::<Owned>(&format!("/collections/{id}"))?
            .project_id),
    }
}

/// Streams `file` to `POST /api/images/upload` under the target's project, then pins it on
/// `target` via `PUT /api/images/parent/:kind/:parentId`.
pub fn set_cover(
    remote: &Remote,
    file: &Path,
    target: CoverTarget,
) -> Result<CoverImage, CoverError> {
    if !file.is_file() {
        return Err(CoverError::Local(format!(
            "could not read {}: file does not exist",
            file.display()
        )));
    }
    let project_id = project_id_of(remote, target)?;
    #[derive(Deserialize)]
    struct Uploaded {
        id: i64,
    }
    let uploaded: Uploaded = upload_file(
        remote,
        "/images/upload",
        &[("projectId", project_id.to_string())],
        file,
        "cover",
        image_content_type(file),
        &mut |_, _| {},
    )?;
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PinBody {
        image_id: i64,
    }
    let pinned: CoverImage = remote.put(
        &format!("/images/parent/{}/{}", target.kind_name(), target.id()),
        &PinBody {
            image_id: uploaded.id,
        },
    )?;
    Ok(pinned)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::super::test_support::{MockServer, Reply, remote_to};
    use super::*;

    #[test]
    fn sets_a_track_cover_after_resolving_its_project() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cover.png");
        fs::write(&path, b"\x89PNG\r\n\x1a\nfake").unwrap();

        let server = MockServer::start_replies(vec![
            Reply::json(200, r#"{"id":12,"projectId":7}"#),
            Reply::json(
                201,
                r#"{"id":99,"assetPath":"images/abc.png","variantsJobId":1}"#,
            ),
            Reply::json(
                200,
                r#"{"id":99,"assetPath":"images/abc.png","size":12,"scope":"project","projectId":7,"accentHue":210.5,"accentChroma":0.12}"#,
            ),
        ]);
        let remote = remote_to(&server);

        let image = set_cover(&remote, &path, CoverTarget::Track(12)).unwrap();

        assert_eq!(image.id, 99);
        assert_eq!(image.asset_path, "images/abc.png");
        assert_eq!(image.project_id, Some(7));
        let requests = server.requests();
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[0].method, "GET");
        assert_eq!(requests[0].path_only(), "/api/tracks/12");
        assert_eq!(requests[1].method, "POST");
        assert_eq!(requests[1].path_only(), "/api/images/upload");
        assert!(
            String::from_utf8_lossy(&requests[1].body).contains("name=\"projectId\"\r\n\r\n7\r\n")
        );
        assert!(String::from_utf8_lossy(&requests[1].body).contains("Content-Type: image/png"));
        assert_eq!(requests[2].method, "PUT");
        assert_eq!(requests[2].path_only(), "/api/images/parent/track/12");
        assert_eq!(requests[2].json(), serde_json::json!({ "imageId": 99 }));
    }

    #[test]
    fn sets_a_project_cover_without_an_extra_lookup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("art.jpg");
        fs::write(&path, b"\xff\xd8\xff\xe0fake").unwrap();

        let server = MockServer::start_replies(vec![
            Reply::json(
                201,
                r#"{"id":55,"assetPath":"images/p.jpg","variantsJobId":null}"#,
            ),
            Reply::json(200, r#"{"id":55,"assetPath":"images/p.jpg","projectId":4}"#),
        ]);
        let remote = remote_to(&server);

        let image = set_cover(&remote, &path, CoverTarget::Project(4)).unwrap();

        assert_eq!(image.id, 55);
        let requests = server.requests();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].path_only(), "/api/images/upload");
        assert_eq!(requests[1].path_only(), "/api/images/parent/project/4");
    }

    #[test]
    fn missing_file_fails_before_talking_to_the_hub() {
        let dir = tempfile::tempdir().unwrap();
        let server = MockServer::start_replies(vec![]);
        let remote = remote_to(&server);

        let err =
            set_cover(&remote, &dir.path().join("nope.png"), CoverTarget::Track(1)).unwrap_err();
        assert!(matches!(err, CoverError::Local(_)));
        assert!(server.requests().is_empty());
    }
}
