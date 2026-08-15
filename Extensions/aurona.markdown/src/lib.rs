use exports::aurona::extensions::render::{Guest, RenderInput, RenderOutput};

wit_bindgen::generate!({
    path: "../wit/world.wit",
    world: "aurona-extension",
});

struct MarkdownExtension;

fn render_markdown(markdown: &str) -> Result<RenderOutput, String> {
    let options =
        pulldown_cmark::Options::ENABLE_TABLES | pulldown_cmark::Options::ENABLE_STRIKETHROUGH;
    let parser = pulldown_cmark::Parser::new_ext(markdown, options);

    let mut html = String::new();
    pulldown_cmark::html::push_html(&mut html, parser);

    let clean = ammonia::Builder::default().clean(&html).to_string();

    let mut diagnostics = Vec::new();
    if markdown.len() > 512 * 1024 {
        diagnostics.push("document is very large, preview refresh is reduced".to_string());
    }

    Ok(RenderOutput {
        html: clean,
        diagnostics,
    })
}

impl Guest for MarkdownExtension {
    fn render(input: RenderInput) -> Result<RenderOutput, String> {
        render_markdown(&input.markdown)
    }
}

export!(MarkdownExtension);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_render_heading() {
        let output = render_markdown("# Hello").unwrap();
        assert!(output.html.contains("<h1>Hello</h1>"), "{}", output.html);
    }

    #[test]
    fn native_render_table() {
        let output = render_markdown("| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~").unwrap();
        assert!(output.html.contains("<table>"), "{}", output.html);
        assert!(output.html.contains("<del>gone</del>"), "{}", output.html);
    }

    #[test]
    fn native_sanitize() {
        let output =
            render_markdown("<script>alert(1)</script>\n\n[click](javascript:alert(1))").unwrap();
        assert!(!output.html.contains("<script"), "{}", output.html);
        assert!(!output.html.contains("javascript:"), "{}", output.html);
    }
}
