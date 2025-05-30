// Extracts a single correlation key and sends it upward.
// Adjust the regexes to fit your naming scheme.

(function () {
  const url = window.location.href;

  let key = null;

  // ---- Elastic (Kibana Discover or Dashboard) ----
  // Example: kubernetes.deployment.name : "svc-foo-prod"
  if (/elastic\./.test(url)) {
    const match = decodeURIComponent(url).match(
      /kubernetes\.deployment\.name[^"]+"([^"]+)"/
    );
    if (match) key = match[1];
  }

  // ---- GitLab ----
  // Example: https://gitlab.company.com/group/project
  if (/gitlab\./.test(url)) {
    const parts = location.pathname.split("/");
    key = parts.slice(-1)[0] || parts.slice(-2)[0]; // project name
  }

  // ---- Jenkins ----
  // Example: https://jenkins.company.com/job/svc-foo-prod/
  if (/jenkins\./.test(url)) {
    const match = url.match(/job\/([^/]+)/);
    if (match) key = match[1];
  }

  if (key) {
    chrome.runtime.sendMessage({ type: "STACKSYNC_KEY", key });
  }
})();
