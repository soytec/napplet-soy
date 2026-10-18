/** Keep the real soyLI host bridge and sandbox; compact only Studio's embedded view. */
export function studioPreviewHtml(html: string) {
  return html.replace(
    '<header>',
    `<script>
    if (new URLSearchParams(location.search).get('studio') === '1') document.documentElement.dataset.studio = 'true';
  </script><style>
    html[data-studio], html[data-studio] body {width:100%;height:100%;margin:0;overflow:hidden}
    html[data-studio] body > header, html[data-studio] #files {display:none}
    html[data-studio] #stage {position:fixed;inset:0;margin:0;padding:0}
    html[data-studio] #stage iframe {width:100%;height:100%;min-height:0;border:0;display:block}
    html[data-studio] #status {position:fixed;inset:0;display:grid;place-items:center;padding:20px;box-sizing:border-box}
    html[data-studio] body:has(#stage iframe) #status {display:none}
  </style><header>`,
  );
}
