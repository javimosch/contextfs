'use strict';

/**
 * Lightweight markdown-to-ANSI renderer for terminal output.
 * Handles bold, italic, inline code, code blocks, and headings.
 * Falls back to plain text for non-TTY environments.
 */

function renderMarkdown(text) {
  // Code blocks: ```...```
  text = text.replace(/```([^\n]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    // Cyan for code blocks
    return `\x1b[36m${match}\x1b[0m`;
  });

  // Headings: #, ##, ###
  text = text.replace(/^(#{1,3})\s+(.+)$/gm, (match, hashes, heading) => {
    // Yellow for headings
    return `\x1b[33m${match}\x1b[0m`;
  });

  // Bold: **text**
  text = text.replace(/\*\*([^\*]+)\*\*/g, (match, bold) => {
    // Bright white (bold ANSI code 1m)
    return `\x1b[1m${bold}\x1b[0m`;
  });

  // Italic: *text*
  text = text.replace(/\*([^\*]+)\*/g, (match, italic) => {
    // Dim (ANSI code 2m)
    return `\x1b[2m${italic}\x1b[0m`;
  });

  // Inline code: `text`
  text = text.replace(/`([^`]+)`/g, (match, code) => {
    // Cyan for inline code
    return `\x1b[36m${code}\x1b[0m`;
  });

  return text;
}

/**
 * Render markdown to ANSI if TTY, otherwise return plain text.
 */
function render(text) {
  if (!process.stdout.isTTY) {
    return text;
  }
  return renderMarkdown(text);
}

module.exports = { render, renderMarkdown };
