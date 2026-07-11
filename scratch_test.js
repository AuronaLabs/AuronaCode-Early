const html = `<span class="hljs-keyword">let</span> a = <span class="hljs-string">"hello"</span>;`;
const regex = /<span class="([^"]+)">|<\/span>|([^<]+)/g;

let currentLine = 0;
let currentOffset = 0;
let activeClasses = [];
const linesTokens = [[]];

let match;
while ((match = regex.exec(html)) !== null) {
  if (match[1]) {
    // <span class="...">
    activeClasses.unshift(match[1]);
  } else if (match[0] === '</span>') {
    activeClasses.shift();
  } else if (match[2]) {
    const text = match[2];
    const textLines = text.split(/\r?\n/);
    
    textLines.forEach((textLine, i) => {
      if (i > 0) {
        currentLine++;
        currentOffset = 0;
        linesTokens.push([]);
      }
      
      if (textLine.length > 0) {
        let type = 0; // determine type from activeClasses
        if (activeClasses.length > 0) type = 1; // dummy type
        
        if (type > 0) {
          linesTokens[currentLine].push(currentOffset, textLine.length, type);
        }
        currentOffset += textLine.length;
      }
    });
  }
}

console.log(linesTokens);
