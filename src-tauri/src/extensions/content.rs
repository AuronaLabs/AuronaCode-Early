use cssparser::{Parser, Token};
use std::collections::HashSet;

const HTML_BYTES: usize = 2 * 1024 * 1024;
const SVG_BYTES: usize = 256 * 1024;

fn safe_css(source: &str) -> bool {
    fn tokens(parser: &mut Parser<'_>, depth: usize, count: &mut usize) -> bool {
        if depth > 64 {
            return false;
        }
        while !parser.is_exhausted() {
            *count += 1;
            if *count > 100_000 {
                return false;
            }
            let Ok(token) = parser.next_including_whitespace_and_comments().cloned() else {
                return false;
            };
            match token {
                Token::UnquotedUrl(_) | Token::BadUrl(_) | Token::BadString(_) => return false,
                Token::AtKeyword(name)
                    if ![
                        "media",
                        "supports",
                        "keyframes",
                        "-webkit-keyframes",
                        "layer",
                        "container",
                    ]
                    .iter()
                    .any(|allowed| name.eq_ignore_ascii_case(allowed)) =>
                {
                    return false
                }
                Token::Function(name) => {
                    if [
                        "url",
                        "image",
                        "image-set",
                        "-webkit-image-set",
                        "expression",
                        "src",
                        "paint",
                    ]
                    .iter()
                    .any(|blocked| name.eq_ignore_ascii_case(blocked))
                    {
                        return false;
                    }
                    let result: Result<(), cssparser::ParseError<()>> =
                        parser.parse_nested_block(|nested| {
                            if tokens(nested, depth + 1, count) {
                                Ok(())
                            } else {
                                Err(nested.new_error_for_next_token())
                            }
                        });
                    if result.is_err() {
                        return false;
                    }
                }
                Token::ParenthesisBlock | Token::SquareBracketBlock | Token::CurlyBracketBlock => {
                    let result: Result<(), cssparser::ParseError<()>> =
                        parser.parse_nested_block(|nested| {
                            if tokens(nested, depth + 1, count) {
                                Ok(())
                            } else {
                                Err(nested.new_error_for_next_token())
                            }
                        });
                    if result.is_err() {
                        return false;
                    }
                }
                Token::Delim('<') => return false,
                _ => {}
            }
        }
        true
    }
    tokens(&mut Parser::new(source), 0, &mut 0)
}

fn safe_raster(value: &str) -> bool {
    let Some((mime, encoded)) = value.split_once(";base64,") else {
        return false;
    };
    matches!(
        mime,
        "data:image/png" | "data:image/jpeg" | "data:image/gif" | "data:image/webp"
    ) && encoded.len() <= HTML_BYTES
        && encoded
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
}

pub fn html(source: &str) -> Result<String, String> {
    if source.len() > HTML_BYTES {
        return Err("[resource.limit] Extension HTML exceeds 2 MiB".into());
    }
    let document = scraper::Html::parse_document(source);
    if document.tree.nodes().count() > 100_000 {
        return Err("[resource.limit] Extension HTML has too many nodes".into());
    }
    let selector = scraper::Selector::parse("style").map_err(|e| e.to_string())?;
    let styles = document
        .select(&selector)
        .filter_map(|element| {
            let value = element.text().collect::<String>();
            safe_css(&value).then(|| format!("<style>{value}</style>"))
        })
        .collect::<String>();
    let clean = ammonia::Builder::default()
        .clean_content_tags(HashSet::from([
            "script", "style", "svg", "math", "iframe", "object", "embed", "form", "input",
            "textarea", "select", "button", "template",
        ]))
        .generic_attributes(HashSet::from([
            "id",
            "class",
            "title",
            "style",
            "role",
            "aria-label",
            "aria-hidden",
        ]))
        .generic_attribute_prefixes(HashSet::from(["data-"]))
        .url_schemes(HashSet::from(["data"]))
        .url_relative(ammonia::UrlRelative::Deny)
        .strip_comments(false)
        .attribute_filter(|element, attribute, value| {
            if attribute == "href"
                || attribute == "srcset"
                || attribute == "action"
                || attribute == "formaction"
                || attribute == "ping"
                || attribute == "target"
            {
                return None;
            }
            if attribute == "src" && (element != "img" || !safe_raster(value)) {
                return None;
            }
            if attribute == "style" && !safe_css(value) {
                return None;
            }
            Some(value.into())
        })
        .clean(source)
        .to_string();
    let result = format!("{styles}{clean}");
    if result.len() > HTML_BYTES {
        return Err("[resource.limit] Sanitized HTML exceeds 2 MiB".into());
    }
    Ok(result)
}

pub fn svg(source: &str) -> Result<String, String> {
    use quick_xml::{
        events::{BytesStart, Event},
        Reader, Writer,
    };
    if source.len() > SVG_BYTES {
        return Err("[resource.limit] SVG exceeds 256 KiB".into());
    }
    let tags = HashSet::from([
        "svg",
        "g",
        "path",
        "rect",
        "circle",
        "ellipse",
        "line",
        "polyline",
        "polygon",
        "defs",
        "linearGradient",
        "radialGradient",
        "stop",
        "clipPath",
        "title",
        "desc",
    ]);
    let attributes = HashSet::from([
        "xmlns",
        "viewBox",
        "width",
        "height",
        "d",
        "x",
        "y",
        "x1",
        "y1",
        "x2",
        "y2",
        "cx",
        "cy",
        "r",
        "rx",
        "ry",
        "points",
        "fill",
        "fill-rule",
        "fill-opacity",
        "stroke",
        "stroke-width",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-opacity",
        "opacity",
        "transform",
        "id",
        "offset",
        "stop-color",
        "stop-opacity",
        "gradientUnits",
        "gradientTransform",
        "clip-path",
        "clip-rule",
        "preserveAspectRatio",
    ]);
    let mut reader = Reader::from_str(source);
    let mut writer = Writer::new(Vec::new());
    let mut nodes = 0usize;
    let mut root = false;
    loop {
        let event = reader
            .read_event()
            .map_err(|_| "[extension.svg] Malformed SVG")?;
        match event {
            Event::Start(ref element) | Event::Empty(ref element) => {
                nodes += 1;
                if nodes > 4096 {
                    return Err("[resource.limit] SVG has too many elements".into());
                }
                let name = element.name();
                let name = name.as_ref();
                if !root {
                    if name != "svg" {
                        return Err("[extension.svg] Expected SVG root".into());
                    }
                    root = true;
                }
                if !tags.contains(name) {
                    return Err("[extension.svg] Prohibited SVG element".into());
                }
                let mut clean = BytesStart::new(name);
                for attribute in element.attributes() {
                    let attribute = attribute.map_err(|_| "[extension.svg] Invalid attribute")?;
                    let key = attribute.key.as_ref();
                    if !attributes.contains(key) {
                        continue;
                    }
                    let value = attribute
                        .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                        .map_err(|_| "[extension.svg] Invalid value")?;
                    if value.len() > 32 * 1024 {
                        return Err("[resource.limit] SVG attribute too large".into());
                    }
                    if key == "xmlns" && value != "http://www.w3.org/2000/svg" {
                        continue;
                    }
                    if value.to_ascii_lowercase().contains("url") {
                        let local = value
                            .strip_prefix("url(#")
                            .and_then(|v| v.strip_suffix(')'))
                            .is_some_and(|v| {
                                !v.is_empty()
                                    && v.bytes().all(|b| {
                                        b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
                                    })
                            });
                        if !local {
                            continue;
                        }
                    }
                    clean.push_attribute((key, value.as_ref()));
                }
                writer
                    .write_event(if matches!(event, Event::Empty(_)) {
                        Event::Empty(clean)
                    } else {
                        Event::Start(clean)
                    })
                    .map_err(|e| e.to_string())?;
            }
            Event::End(element) => writer
                .write_event(Event::End(element))
                .map_err(|e| e.to_string())?,
            Event::Text(text) => writer
                .write_event(Event::Text(text))
                .map_err(|e| e.to_string())?,
            Event::DocType(_) | Event::GeneralRef(_) => {
                return Err("[extension.svg] Entities and DTD are prohibited".into())
            }
            Event::Eof => break,
            Event::Decl(_) | Event::Comment(_) => {}
            _ => return Err("[extension.svg] Prohibited XML construct".into()),
        }
    }
    if !root {
        return Err("[extension.svg] Missing SVG root".into());
    }
    String::from_utf8(writer.into_inner()).map_err(|_| "[extension.svg] Invalid SVG".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn html_removes_navigation_forms_scripts_and_escaped_css_urls() {
        let clean = html(r#"<style>.safe{color:red}.bad{background:u\72l(https://evil.test)}</style><script>alert(1)</script><form action='https://evil.test'><input></form><a href='https://evil.test'>text</a><img src='https://evil.test'><p style='color:red'>ok</p><!--AURONA_RENDER_SLOT-->"#).unwrap();
        assert!(
            !clean.contains("evil.test") && !clean.contains("<script") && !clean.contains("<form")
        );
        assert!(clean.contains("color:red") && clean.contains("AURONA_RENDER_SLOT"));
        assert!(!safe_css(r"@\69mport 'https://evil.test';"));
        assert!(!safe_css(
            r"p{background:image-set('https://evil.test' 1x)}"
        ));
        assert!(safe_css("@media (max-width:800px){p{color:var(--theme)}}"));
    }
    #[test]
    fn svg_rejects_script_entities_and_external_resources() {
        assert!(svg("<svg><script>evil</script></svg>").is_err());
        assert!(svg("<!DOCTYPE svg [<!ENTITY x SYSTEM 'file:///secret'>]><svg>&x;</svg>").is_err());
        let clean = svg(r#"<svg xmlns="http://www.w3.org/2000/svg" onload="evil()"><path fill="url(https://evil.test)" d="M0 0L1 1"/></svg>"#).unwrap();
        assert!(!clean.contains("evil") && clean.contains("M0 0L1 1"));
    }
}
