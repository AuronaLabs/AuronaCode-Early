use serde_json::Value;
use std::io::Read;
use std::sync::LazyLock;
use tauri::Manager;

static MESSAGES: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../resources/authorization-dialogs.json"))
        .expect("authorization translations are validated during quality checks")
});

fn locale(app: &tauri::AppHandle) -> Option<String> {
    let root = app.path().app_local_data_dir().ok()?;
    let directory = cap_std::fs::Dir::open_ambient_dir(root, cap_std::ambient_authority()).ok()?;
    let file =
        crate::scoped_file::open(&directory, std::path::Path::new("user-config.json")).ok()?;
    let mut bytes = Vec::new();
    file.take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > 4 * 1024 * 1024 {
        return None;
    }
    serde_json::from_slice::<Value>(&bytes)
        .ok()?
        .get("locale")?
        .as_str()
        .map(str::to_owned)
}

pub fn text(app: &tauri::AppHandle, kind: &str, fields: &[(&str, &str)]) -> (String, String) {
    let language = locale(app).unwrap_or_else(|| "en".into());
    let messages = MESSAGES.get(&language).unwrap_or(&MESSAGES["en"]);
    let template = messages[kind].as_str().unwrap_or("");
    let mut body = String::new();
    let mut remaining = template;
    while let Some(start) = remaining.find('{') {
        body.push_str(&remaining[..start]);
        let Some(end) = remaining[start..].find('}') else {
            break;
        };
        let key = &remaining[start + 1..start + end];
        if let Some((_, value)) = fields.iter().find(|(field, _)| *field == key) {
            body.push_str(value);
        }
        remaining = &remaining[start + end + 1..];
    }
    body.push_str(remaining);
    (
        messages["title"].as_str().unwrap_or("Aurona Code").into(),
        body,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_six_locales_have_matching_keys_and_placeholders() {
        let expected = MESSAGES["en"].as_object().unwrap();
        assert_eq!(MESSAGES.as_object().unwrap().len(), 6);
        for language in MESSAGES.as_object().unwrap().values() {
            let language = language.as_object().unwrap();
            assert_eq!(
                language.keys().collect::<Vec<_>>(),
                expected.keys().collect::<Vec<_>>()
            );
            for (key, value) in language {
                let fields = |text: &str| {
                    text.split('{')
                        .skip(1)
                        .filter_map(|part| part.split('}').next())
                        .map(str::to_owned)
                        .collect::<std::collections::BTreeSet<_>>()
                };
                assert_eq!(
                    fields(value.as_str().unwrap()),
                    fields(expected[key].as_str().unwrap())
                );
            }
        }
    }
}
