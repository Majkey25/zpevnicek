export default function renderSongContent(content) {
  // Escape source text before adding the two supported, fixed markup forms.
  return content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;(\/?)strong&gt;/g, "<$1strong>")
    .split("[").join('<em class="chord">')
    .split("]").join("</em>");
}
