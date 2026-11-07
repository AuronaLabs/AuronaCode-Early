import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

function walk(node, visit) {
  visit(node);
  node.children?.forEach((child) => walk(child, visit));
}

// Reuse the declared application renderer and GFM plugins, without a second parser dependency.
export function parseMarkdown(source) {
  const links = [];
  const headings = new Set();
  const errors = [];
  let tables = 0;
  const captureMarkdown = () => (tree) => walk(tree, (node) => {
    if (["link", "image", "definition"].includes(node.type)) links.push(node);
    if (node.type === "html") {
      for (const match of node.value.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) headings.add(match[1]);
    }
    if (node.type !== "table") return;
    tables++;
    const width = node.children[0]?.children.length;
    for (const row of node.children) {
      if (row.children.length !== width) errors.push(`line ${row.position.start.line}: table has ${row.children.length} cells; expected ${width}`);
    }
  });
  const captureHeadings = () => (tree) => walk(tree, (node) => {
    if (node.type === "element" && node.properties?.id) headings.add(String(node.properties.id));
  });
  renderToStaticMarkup(createElement(Markdown, {
    remarkPlugins: [remarkGfm, captureMarkdown],
    rehypePlugins: [rehypeSlug, captureHeadings],
    children: source,
  }));
  let fence;
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!match) continue;
    if (!fence) fence = { marker: match[1][0], width: match[1].length, line: index + 1 };
    else if (match[1][0] === fence.marker && match[1].length >= fence.width && !match[2].trim()) fence = undefined;
  }
  if (fence) errors.push(`line ${fence.line}: unclosed code fence`);
  return { links, headings, tables, errors };
}

export function localDestination(url) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) return null;
  const hash = url.indexOf("#");
  const location = hash < 0 ? url : url.slice(0, hash);
  return {
    path: decodeURIComponent(location.split("?")[0]),
    fragment: hash < 0 ? "" : decodeURIComponent(url.slice(hash + 1)),
  };
}

export function validateDocuments(root, files) {
  const documents = new Map();
  const directoryNames = new Map();
  const pathError = (target) => {
    let directory = path.resolve(root);
    for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
      if (!directoryNames.has(directory)) directoryNames.set(directory, fs.readdirSync(directory));
      const names = directoryNames.get(directory);
      if (!names.includes(segment)) return names.some((name) => name.toLowerCase() === segment.toLowerCase())
        ? "path case mismatch" : "missing target";
      directory = path.join(directory, segment);
      if (directory !== target && !fs.statSync(directory).isDirectory()) return "missing target";
    }
    return null;
  };
  const read = (file) => {
    const absolute = path.resolve(file);
    if (!documents.has(absolute)) documents.set(absolute, parseMarkdown(fs.readFileSync(absolute, "utf8")));
    return documents.get(absolute);
  };
  const errors = [];
  let relativeLinks = 0;
  let tables = 0;
  for (const file of files) {
    const absolute = path.resolve(root, file);
    const document = read(absolute);
    tables += document.tables;
    errors.push(...document.errors.map((error) => `${file}: ${error}`));
    for (const node of document.links) {
      const location = `${file}:${node.position.start.line}`;
      let destination;
      try { destination = localDestination(node.url); }
      catch { errors.push(`${location}: malformed URL ${node.url}`); continue; }
      if (!destination) continue;
      relativeLinks++;
      const target = !destination.path ? absolute : destination.path.startsWith("/")
        ? path.resolve(root, destination.path.slice(1))
        : path.resolve(path.dirname(absolute), destination.path);
      const relative = path.relative(root, target);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        errors.push(`${location}: link escapes repository: ${node.url}`);
      } else {
        const problem = pathError(target);
        if (problem) errors.push(`${location}: ${problem} ${node.url}`);
        else if (destination.fragment && /\.md$/i.test(target) && !read(target).headings.has(destination.fragment)) {
          errors.push(`${location}: missing heading ${node.url}`);
        }
      }
    }
  }
  return { documents: files.length, relativeLinks, tables, errors };
}
