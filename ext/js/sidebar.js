class StackSyncSidebar {
  constructor() {
    this.settings = {
      elasticUrl: "",
      gitlabUrl: "",
      jenkinsUrl: "",
      namingPattern: "",
    };
    this.currentProject = null;
    this.currentPlatform = null;

    this.init();
  }

  async init() {
    await this.loadSettings();
    this.setupEventListeners();
    this.analyzeCurrentPage();
    this.startPageMonitoring();
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get([
        "elasticUrl",
        "gitlabUrl",
        "jenkinsUrl",
        "namingPattern",
      ]);

      this.settings = {
        elasticUrl: result.elasticUrl || "",
        gitlabUrl: result.gitlabUrl || "",
        jenkinsUrl: result.jenkinsUrl || "",
        namingPattern: result.namingPattern || "",
      };

      this.populateSettingsForm();
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }

  async saveSettings() {
    try {
      await chrome.storage.sync.set(this.settings);
      this.updateStatus("Settings saved!", "success");
      setTimeout(() => this.hideSettings(), 1000);
    } catch (error) {
      console.error("Failed to save settings:", error);
      this.updateStatus("Failed to save settings", "error");
    }
  }

  setupEventListeners() {
    document.getElementById("settingsBtn").addEventListener("click", () => {
      this.showSettings();
    });

    document.getElementById("saveSettings").addEventListener("click", () => {
      this.collectSettingsFromForm();
      this.saveSettings();
    });

    document.getElementById("cancelSettings").addEventListener("click", () => {
      this.hideSettings();
      this.populateSettingsForm(); // Reset form
    });

    // Handle correlation item clicks
    document.addEventListener("click", (e) => {
      const correlationItem = e.target.closest(".correlation-item");
      if (correlationItem) {
        const url = correlationItem.dataset.url;
        if (url) {
          chrome.tabs.create({ url });
        }
      }
    });
  }

  populateSettingsForm() {
    document.getElementById("elasticUrl").value = this.settings.elasticUrl;
    document.getElementById("gitlabUrl").value = this.settings.gitlabUrl;
    document.getElementById("jenkinsUrl").value = this.settings.jenkinsUrl;
    document.getElementById("namingPattern").value =
      this.settings.namingPattern;
  }

  collectSettingsFromForm() {
    this.settings.elasticUrl = document
      .getElementById("elasticUrl")
      .value.trim();
    this.settings.gitlabUrl = document.getElementById("gitlabUrl").value.trim();
    this.settings.jenkinsUrl = document
      .getElementById("jenkinsUrl")
      .value.trim();
    this.settings.namingPattern = document
      .getElementById("namingPattern")
      .value.trim();
  }

  showSettings() {
    document.getElementById("settingsPanel").classList.add("open");
  }

  hideSettings() {
    document.getElementById("settingsPanel").classList.remove("open");
  }

  async analyzeCurrentPage() {
    try {
      // Get current tab information
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab || !tab.url) {
        this.updateStatus("Unable to analyze current page", "error");
        return;
      }

      const url = new URL(tab.url);
      const platform = this.detectPlatform(url);
      const project = await this.extractProjectName(tab, platform);

      this.currentPlatform = platform;
      this.currentProject = project;

      this.updateUI();
      this.generateCorrelations();
    } catch (error) {
      console.error("Error analyzing page:", error);
      this.updateStatus("Error analyzing page", "error");
    }
  }

  detectPlatform(url) {
    const hostname = url.hostname.toLowerCase();

    if (hostname.includes("elastic") || hostname.includes("kibana")) {
      return "elastic";
    } else if (hostname.includes("gitlab")) {
      return "gitlab";
    } else if (hostname.includes("jenkins")) {
      return "jenkins";
    }

    return "unknown";
  }

  async extractProjectName(tab, platform) {
    try {
      // Execute content script to extract project information
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: this.getContentScriptFunction(platform),
      });

      if (results && results[0] && results[0].result) {
        return results[0].result;
      }
    } catch (error) {
      console.error("Error extracting project name:", error);
    }

    // Fallback: try to extract from URL
    return this.extractProjectFromUrl(tab.url, platform);
  }

  getContentScriptFunction(platform) {
    switch (platform) {
      case "elastic":
        return () => {
          // Look for kubernetes.deployment.name filter
          const filters = document.querySelectorAll(
            '[data-test-subj*="filter"]'
          );
          for (const filter of filters) {
            const text = filter.textContent || filter.innerText || "";
            const match = text.match(
              /kubernetes\.deployment\.name[:\s]*([a-zA-Z0-9\-_.]+)/i
            );
            if (match) {
              return match[1];
            }
          }

          // Look in query bar
          const queryBar = document.querySelector(
            '[data-test-subj="queryInput"]'
          );
          if (queryBar) {
            const query = queryBar.value || queryBar.textContent || "";
            const match = query.match(
              /kubernetes\.deployment\.name[:\s]*([a-zA-Z0-9\-_.]+)/i
            );
            if (match) {
              return match[1];
            }
          }

          // Look for any deployment name pattern in page
          const pageText = document.body.textContent || "";
          const deploymentMatch = pageText.match(
            /deployment[:\s]*([a-zA-Z0-9\-_.]+)/i
          );
          return deploymentMatch ? deploymentMatch[1] : null;
        };

      case "gitlab":
        return () => {
          // Extract project name from GitLab
          const breadcrumb = document.querySelector(".breadcrumbs-container");
          if (breadcrumb) {
            const links = breadcrumb.querySelectorAll("a");
            const projectLink = Array.from(links).find(
              (link) =>
                !link.href.includes("/groups/") && link.href.includes("/")
            );
            if (projectLink) {
              return projectLink.textContent.trim();
            }
          }

          // Try project header
          const projectName = document.querySelector(
            '[data-testid="project-name"]'
          );
          if (projectName) {
            return projectName.textContent.trim();
          }

          return null;
        };

      case "jenkins":
        return () => {
          // Extract job name from Jenkins
          const jobName = document.querySelector("#main-panel h1");
          if (jobName) {
            const text = jobName.textContent.trim();
            // Remove "Project " or "Job " prefix if present
            return text.replace(/^(Project|Job)\s+/, "");
          }

          // Try breadcrumb
          const breadcrumb = document.querySelector("#breadcrumbBar");
          if (breadcrumb) {
            const links = breadcrumb.querySelectorAll("a");
            if (links.length > 1) {
              return links[links.length - 1].textContent.trim();
            }
          }

          return null;
        };

      default:
        return () => null;
    }
  }

  extractProjectFromUrl(url, platform) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname
        .split("/")
        .filter((part) => part.length > 0);

      switch (platform) {
        case "gitlab":
          // GitLab URLs: /group/project or /user/project
          if (pathParts.length >= 2) {
            return pathParts[1];
          }
          break;

        case "jenkins":
          // Jenkins URLs: /job/project-name
          const jobIndex = pathParts.indexOf("job");
          if (jobIndex >= 0 && pathParts.length > jobIndex + 1) {
            return pathParts[jobIndex + 1];
          }
          break;

        case "elastic":
          // Try to find project name in URL parameters or path
          const params = new URLSearchParams(urlObj.search);
          for (const [key, value] of params) {
            if (key.includes("deployment") || key.includes("app")) {
              return value;
            }
          }
          break;
      }
    } catch (error) {
      console.error("Error extracting from URL:", error);
    }

    return null;
  }

  updateUI() {
    const platformElement = document.getElementById("currentPlatform");
    const projectElement = document.getElementById("projectName");

    platformElement.textContent = this.currentPlatform || "Unknown";
    platformElement.className = `platform ${this.currentPlatform || ""}`;

    projectElement.textContent = this.currentProject || "No project detected";

    if (this.currentProject) {
      this.updateStatus("Project detected", "success");
    } else {
      this.updateStatus("No project detected", "warning");
    }
  }

  generateCorrelations() {
    const correlationList = document.getElementById("correlationList");

    if (!this.currentProject) {
      correlationList.innerHTML =
        '<div class="no-correlations">No project detected</div>';
      return;
    }

    const correlations = [];
    const projectName = this.currentProject;

    // Generate Elastic correlation
    if (this.settings.elasticUrl && this.currentPlatform !== "elastic") {
      const elasticUrl = this.buildElasticUrl(projectName);
      correlations.push({
        platform: "elastic",
        title: "View Logs in Elastic",
        url: elasticUrl,
        icon: "E",
      });
    }

    // Generate GitLab correlation
    if (this.settings.gitlabUrl && this.currentPlatform !== "gitlab") {
      const gitlabUrl = this.buildGitlabUrl(projectName);
      correlations.push({
        platform: "gitlab",
        title: "View in GitLab",
        url: gitlabUrl,
        icon: "G",
      });
    }

    // Generate Jenkins correlation
    if (this.settings.jenkinsUrl && this.currentPlatform !== "jenkins") {
      const jenkinsUrl = this.buildJenkinsUrl(projectName);
      correlations.push({
        platform: "jenkins",
        title: "View in Jenkins",
        url: jenkinsUrl,
        icon: "J",
      });
    }

    this.renderCorrelations(correlations);
  }

  buildElasticUrl(projectName) {
    const baseUrl = this.settings.elasticUrl.replace(/\/$/, "");
    // Build Kibana discover URL with kubernetes.deployment.name filter
    const filter = encodeURIComponent(
      `kubernetes.deployment.name:"${projectName}"`
    );
    return `${baseUrl}/app/discover#/?_g=()&_a=(query:(language:kuery,query:'${filter}'))`;
  }

  buildGitlabUrl(projectName) {
    const baseUrl = this.settings.gitlabUrl.replace(/\/$/, "");
    return `${baseUrl}/${projectName}`;
  }

  buildJenkinsUrl(projectName) {
    const baseUrl = this.settings.jenkinsUrl.replace(/\/$/, "");
    return `${baseUrl}/job/${projectName}/`;
  }

  renderCorrelations(correlations) {
    const correlationList = document.getElementById("correlationList");

    if (correlations.length === 0) {
      correlationList.innerHTML =
        '<div class="no-correlations">Configure URLs in settings to see correlations</div>';
      return;
    }

    const html = correlations
      .map(
        (correlation) => `
      <div class="correlation-item ${correlation.platform}" data-url="${correlation.url}">
        <div class="correlation-icon ${correlation.platform}">
          ${correlation.icon}
        </div>
        <div class="correlation-details">
          <div class="correlation-title">${correlation.title}</div>
          <div class="correlation-url">${correlation.url}</div>
        </div>
      </div>
    `
      )
      .join("");

    correlationList.innerHTML = html;
  }

  updateStatus(message, type = "info") {
    const statusElement = document.getElementById("status");
    statusElement.textContent = message;
    statusElement.className = `status ${type}`;

    // Clear status after 3 seconds
    setTimeout(() => {
      statusElement.textContent = "Ready";
      statusElement.className = "status";
    }, 3000);
  }

  startPageMonitoring() {
    // Monitor for URL changes (SPA navigation)
    let currentUrl = window.location.href;

    setInterval(async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab && tab.url !== currentUrl) {
          currentUrl = tab.url;
          await this.analyzeCurrentPage();
        }
      } catch (error) {
        // Ignore errors during monitoring
      }
    }, 2000);
  }
}

// Initialize the sidebar when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new StackSyncSidebar();
});
