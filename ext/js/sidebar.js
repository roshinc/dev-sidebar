class StackSyncSidebar {
  constructor() {
    this.settings = {
      gitlabUrl: "",
      namingPattern: "",
      configServiceUrl: "",
      elasticSearchServiceUrl: "",
      environments: {
        DEV: {
          name: "DEV",
          elasticUrl: "",
          jenkinsUrl: "",
        },
      },
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
        "gitlabUrl",
        "namingPattern",
        "configServiceUrl",
        "elasticSearchServiceUrl",
        "environments",
      ]);

      this.settings = {
        gitlabUrl: result.gitlabUrl || "",
        namingPattern: result.namingPattern || "",
        configServiceUrl: result.configServiceUrl || "",
        elasticSearchServiceUrl: result.elasticSearchServiceUrl || "",
        environments: result.environments || {
          DEV: {
            name: "DEV",
            elasticUrl: "",
            jenkinsUrl: "",
          },
        },
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
      this.populateSettingsForm();
    });

    document.getElementById("addEnvBtn").addEventListener("click", () => {
      this.addEnvironment();
    });

    document.getElementById("newEnvName").addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        this.addEnvironment();
      }
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

  addEnvironment() {
    const envNameInput = document.getElementById("newEnvName");
    const envName = envNameInput.value.trim().toUpperCase();

    if (!envName) {
      alert("Please enter an environment name");
      return;
    }

    if (this.settings.environments[envName]) {
      alert("Environment already exists");
      return;
    }

    this.settings.environments[envName] = {
      name: envName,
      elasticUrl: "",
      jenkinsUrl: "",
    };

    envNameInput.value = "";
    this.renderEnvironmentsList();
  }

  removeEnvironment(envName) {
    if (Object.keys(this.settings.environments).length <= 1) {
      alert("Cannot remove the last environment");
      return;
    }

    if (confirm(`Remove environment ${envName}?`)) {
      delete this.settings.environments[envName];
      this.renderEnvironmentsList();
    }
  }

  renderEnvironmentsList() {
    const container = document.getElementById("environmentsList");
    const envs = Object.values(this.settings.environments);

    container.innerHTML = envs
      .map(
        (env) => `
      <div class="env-config">
        <div class="env-config-header">
          <div class="env-name">${env.name}</div>
          ${
            envs.length > 1
              ? `<button class="remove-env-btn" onclick="sidebar.removeEnvironment('${env.name}')">Remove</button>`
              : ""
          }
        </div>
        
        <div class="setting-group">
          <label for="elasticUrl_${env.name}">Elastic/Kibana URL:</label>
          <input
            type="text"
            id="elasticUrl_${env.name}"
            placeholder="https://myelastic.dev:9243"
            value="${env.elasticUrl || ""}"
          />
          <small>Used for platform detection and fallback links</small>
        </div>

        <div class="setting-group">
          <label for="jenkinsUrl_${env.name}">Jenkins URL:</label>
          <input
            type="text"
            id="jenkinsUrl_${env.name}"
            placeholder="https://your-jenkins.com"
            value="${env.jenkinsUrl || ""}"
          />
          <small>Used for platform detection and job URLs</small>
        </div>
      </div>
    `
      )
      .join("");
  }

  populateSettingsForm() {
    document.getElementById("gitlabUrl").value = this.settings.gitlabUrl;
    document.getElementById("namingPattern").value =
      this.settings.namingPattern;
    document.getElementById("configServiceUrl").value =
      this.settings.configServiceUrl;
    document.getElementById("elasticSearchServiceUrl").value =
      this.settings.elasticSearchServiceUrl;

    this.renderEnvironmentsList();
  }

  collectSettingsFromForm() {
    this.settings.gitlabUrl = document.getElementById("gitlabUrl").value.trim();
    this.settings.namingPattern = document
      .getElementById("namingPattern")
      .value.trim();
    this.settings.configServiceUrl = document
      .getElementById("configServiceUrl")
      .value.trim();
    this.settings.elasticSearchServiceUrl = document
      .getElementById("elasticSearchServiceUrl")
      .value.trim();

    // Collect environment settings
    Object.keys(this.settings.environments).forEach((envName) => {
      const elasticUrl =
        document.getElementById(`elasticUrl_${envName}`)?.value.trim() || "";
      const jenkinsUrl =
        document.getElementById(`jenkinsUrl_${envName}`)?.value.trim() || "";

      this.settings.environments[envName] = {
        name: envName,
        elasticUrl,
        jenkinsUrl,
      };
    });
  }

  showSettings() {
    document.getElementById("settingsPanel").classList.add("open");
  }

  hideSettings() {
    document.getElementById("settingsPanel").classList.remove("open");
  }

  async analyzeCurrentPage() {
    try {
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
    const fullUrl = url.href.toLowerCase();

    // Check against configured environment URLs
    for (const env of Object.values(this.settings.environments)) {
      if (env.elasticUrl) {
        try {
          const elasticHost = new URL(env.elasticUrl).hostname.toLowerCase();
          if (hostname === elasticHost || hostname.includes(elasticHost)) {
            return "elastic";
          }
        } catch (error) {
          // Invalid URL
        }
      }

      if (env.jenkinsUrl) {
        try {
          const jenkinsHost = new URL(env.jenkinsUrl).hostname.toLowerCase();
          if (hostname === jenkinsHost || hostname.includes(jenkinsHost)) {
            return "jenkins";
          }
        } catch (error) {
          // Invalid URL
        }
      }
    }

    // Check GitLab
    if (this.settings.gitlabUrl) {
      try {
        const gitlabHost = new URL(
          this.settings.gitlabUrl
        ).hostname.toLowerCase();
        if (hostname === gitlabHost || hostname.includes(gitlabHost)) {
          return "gitlab";
        }
      } catch (error) {
        // Invalid URL
      }
    }

    // Fallback detection
    if (hostname.includes("elastic") || hostname.includes("kibana")) {
      return "elastic";
    } else if (hostname.includes("gitlab")) {
      return "gitlab";
    } else if (hostname.includes("jenkins")) {
      return "jenkins";
    }

    // URL pattern detection
    if (fullUrl.includes("/app/discover") || fullUrl.includes("/app/kibana")) {
      return "elastic";
    } else if (
      fullUrl.includes("/-/") ||
      fullUrl.includes("/merge_requests") ||
      fullUrl.includes("/issues")
    ) {
      return "gitlab";
    } else if (fullUrl.includes("/job/") || fullUrl.includes("/build/")) {
      return "jenkins";
    }

    return "unknown";
  }

  async extractProjectName(tab, platform) {
    try {
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

    return this.extractProjectFromUrl(tab.url, platform);
  }

  getContentScriptFunction(platform) {
    switch (platform) {
      case "elastic":
        return () => {
          const url = window.location.href;

          let deploymentMatch = url.match(
            /kubernetes\.deployment\.name[^)]*query:([^)]+)\)/i
          );
          if (deploymentMatch) {
            return decodeURIComponent(deploymentMatch[1]).replace(/['"]/g, "");
          }

          deploymentMatch = url.match(
            /match_phrase.*kubernetes\.deployment\.name:([^)]+)\)/i
          );
          if (deploymentMatch) {
            return decodeURIComponent(deploymentMatch[1]).replace(/['"]/g, "");
          }

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

          return null;
        };

      case "gitlab":
        return () => {
          const pathname = window.location.pathname;
          const gitlabSeparatorIndex = pathname.indexOf("/-/");

          if (gitlabSeparatorIndex > 0) {
            const projectPath = pathname.substring(0, gitlabSeparatorIndex);
            const pathParts = projectPath
              .split("/")
              .filter((part) => part.length > 0);
            if (pathParts.length > 0) {
              return pathParts[pathParts.length - 1];
            }
          }

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

          return null;
        };

      case "jenkins":
        return async () => {
          try {
            const currentUrl = window.location.href;

            if (currentUrl.includes("/job/")) {
              const jobMatch = currentUrl.match(/\/job\/([^\/]+)/);
              if (jobMatch) {
                const jobName = jobMatch[1];
                const baseUrl = currentUrl.split("/job/")[0];
                const configUrl = `${baseUrl}/job/${jobName}/config.xml`;

                const response = await fetch(configUrl);
                if (response.ok) {
                  const xmlText = await response.text();
                  const parser = new DOMParser();
                  const xmlDoc = parser.parseFromString(xmlText, "text/xml");

                  const pipelineScript =
                    xmlDoc.querySelector("script")?.textContent ?? "";
                  if (pipelineScript) {
                    const appNameMatch = pipelineScript.match(
                      /def\s+_appName\s*=\s*['"]([^'"]+)['"]/
                    );
                    if (appNameMatch) {
                      return appNameMatch[1];
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.log("Could not fetch Jenkins config.xml:", error);
          }

          const jobName = document.querySelector("#main-panel h1");
          if (jobName) {
            const text = jobName.textContent.trim();
            return text.replace(/^(Project|Job)\s+/, "");
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
        case "elastic":
          const fullUrl = url;
          let deploymentMatch = fullUrl.match(
            /kubernetes\.deployment\.name[^)]*query:([^)]+)\)/i
          );
          if (deploymentMatch) {
            return decodeURIComponent(deploymentMatch[1]).replace(/['"]/g, "");
          }
          break;

        case "gitlab":
          const gitlabSeparatorIndex = pathParts.indexOf("-");
          let projectPath =
            gitlabSeparatorIndex > 0
              ? pathParts.slice(0, gitlabSeparatorIndex)
              : pathParts;
          if (projectPath.length > 0) {
            return projectPath[projectPath.length - 1];
          }
          break;

        case "jenkins":
          const jobMatch = urlObj.pathname.match(/\/job\/([^\/]+)/);
          if (jobMatch) {
            return jobMatch[1];
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

  async generateCorrelations() {
    const correlationList = document.getElementById("correlationList");

    if (!this.currentProject) {
      correlationList.innerHTML =
        '<div class="no-correlations">No project detected</div>';
      return;
    }

    this.updateStatus("Loading correlations...", "info");

    try {
      const appConfig = await this.fetchAppConfig(this.currentProject);

      if (!appConfig) {
        correlationList.innerHTML =
          '<div class="no-correlations">App not found in config service</div>';
        this.updateStatus("App not found in config service", "warning");
        return;
      }

      // Group correlations by environment
      const correlationsByEnv = {};

      for (const [envName, envConfig] of Object.entries(
        this.settings.environments
      )) {
        const envCorrelations = [];

        // Generate Elastic correlation for this environment
        if (
          this.settings.elasticSearchServiceUrl &&
          this.currentPlatform !== "elastic"
        ) {
          try {
            const elasticUrl = await this.fetchElasticUrl(
              this.currentProject,
              appConfig.product,
              envName
            );
            if (elasticUrl) {
              envCorrelations.push({
                platform: "elastic",
                title: "View Logs in Elastic",
                url: elasticUrl,
                icon: "E",
              });
            }
          } catch (error) {
            console.error(`Error fetching Elastic URL for ${envName}:`, error);
            // Fallback to configured Elastic URL if service fails
            if (envConfig.elasticUrl) {
              const fallbackUrl = this.buildElasticUrl(
                this.currentProject,
                envConfig.elasticUrl
              );
              envCorrelations.push({
                platform: "elastic",
                title: "View Logs in Elastic (Fallback)",
                url: fallbackUrl,
                icon: "E",
              });
            }
          }
        }

        // Generate Jenkins correlation for this environment
        if (
          appConfig.jobId &&
          envConfig.jenkinsUrl &&
          this.currentPlatform !== "jenkins"
        ) {
          const jenkinsJobId = this.adaptJobIdForEnvironment(
            appConfig.jobId,
            envName
          );
          const jenkinsUrl = this.buildJenkinsUrlFromJobId(
            jenkinsJobId,
            envConfig.jenkinsUrl
          );
          envCorrelations.push({
            platform: "jenkins",
            title: "View in Jenkins",
            url: jenkinsUrl,
            icon: "J",
          });
        }

        if (envCorrelations.length > 0) {
          correlationsByEnv[envName] = envCorrelations;
        }
      }

      // Add GitLab correlation (environment-independent)
      const gitlabCorrelation = [];
      if (appConfig.gitURL && this.currentPlatform !== "gitlab") {
        const gitlabUrl = this.convertGitUrlToWebUrl(appConfig.gitURL);
        if (gitlabUrl) {
          gitlabCorrelation.push({
            platform: "gitlab",
            title: "View in GitLab",
            url: gitlabUrl,
            icon: "G",
          });
        }
      }

      this.renderCorrelations(correlationsByEnv, gitlabCorrelation, appConfig);

      const totalCorrelations =
        Object.values(correlationsByEnv).reduce(
          (sum, envCorrs) => sum + envCorrs.length,
          0
        ) + gitlabCorrelation.length;
      this.updateStatus(`Found ${totalCorrelations} correlations`, "success");
    } catch (error) {
      console.error("Error generating correlations:", error);
      correlationList.innerHTML =
        '<div class="no-correlations">Error loading correlations</div>';
      this.updateStatus("Error loading correlations", "error");
    }
  }

  adaptJobIdForEnvironment(jobId, targetEnv) {
    // Replace environment in job ID
    // Example: "fwrk-dev-nimbus-service" -> "fwrk-prod-nimbus-service" for PROD env
    const targetEnvLower = targetEnv.toLowerCase();

    // Common environment patterns to replace
    const envPatterns = ["dev", "test", "prod", "staging", "qa"];

    for (const pattern of envPatterns) {
      const regex = new RegExp(`\\b${pattern}\\b`, "gi");
      if (regex.test(jobId)) {
        return jobId.replace(regex, targetEnvLower);
      }
    }

    // If no environment found, try to inject it after the first segment
    const parts = jobId.split("-");
    if (parts.length >= 2) {
      return `${parts[0]}-${targetEnvLower}-${parts.slice(1).join("-")}`;
    }

    return `${jobId}-${targetEnvLower}`;
  }

  async fetchAppConfig(appName) {
    if (!this.settings.configServiceUrl) {
      throw new Error("Config service URL not configured");
    }

    try {
      const url = `${this.settings.configServiceUrl}/app-config/config/artifact/app/${appName}`;
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error fetching app config:", error);
      throw error;
    }
  }

  async fetchElasticUrl(appName, appProduct, environment) {
    if (!this.settings.elasticSearchServiceUrl) {
      return null;
    }

    try {
      const url = `${this.settings.elasticSearchServiceUrl}/elastic-search/api/elastic-search/get-elastic-url?appName=${appName}&appProduct=${appProduct}&envID=${environment}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const elasticUrl = await response.text();
      return elasticUrl.trim();
    } catch (error) {
      console.error("Error fetching Elastic URL:", error);
      return null;
    }
  }

  buildElasticUrl(projectName, elasticBaseUrl) {
    const baseUrl = elasticBaseUrl.replace(/\/$/, "");

    const filter = {
      $state: { store: "appState" },
      meta: {
        alias: null,
        disabled: false,
        field: "kubernetes.deployment.name",
        key: "kubernetes.deployment.name",
        negate: false,
        params: { query: projectName },
        type: "phrase",
      },
      query: {
        match_phrase: {
          "kubernetes.deployment.name": projectName,
        },
      },
    };

    const encodedFilter = encodeURIComponent(JSON.stringify(filter));
    return `${baseUrl}/app/discover#/?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-1h,to:now))&_a=(columns:!(message),filters:!(${encodedFilter}),hideChart:!f,interval:auto,query:(language:kuery,query:''),sort:!(!('@timestamp',desc)))`;
  }

  buildJenkinsUrlFromJobId(jobId, jenkinsBaseUrl) {
    const baseUrl = jenkinsBaseUrl.replace(/\/$/, "");
    return `${baseUrl}/job/${jobId}/`;
  }

  convertGitUrlToWebUrl(gitUrl) {
    try {
      if (gitUrl.startsWith("git@")) {
        const match = gitUrl.match(/git@([^:]+):(.+)\.git$/);
        if (match) {
          const [, host, path] = match;
          return `https://${host}/${path}`;
        }
      } else if (gitUrl.startsWith("https://")) {
        return gitUrl.replace(/\.git$/, "");
      }
      return null;
    } catch (error) {
      console.error("Error converting git URL:", error);
      return null;
    }
  }

  renderCorrelations(correlationsByEnv, gitlabCorrelations, appConfig = null) {
    const correlationList = document.getElementById("correlationList");

    const envNames = Object.keys(correlationsByEnv);
    const hasCorrelations =
      envNames.length > 0 || gitlabCorrelations.length > 0;

    if (!hasCorrelations) {
      correlationList.innerHTML =
        '<div class="no-correlations">Configure environments in settings to see correlations</div>';
      return;
    }

    let html = "";

    // Add app info section if we have config
    if (appConfig) {
      html += `
        <div class="app-info">
          <div class="app-info-header">
            <span class="app-type">${appConfig.type || "N/A"}</span>
            <span class="app-product">${appConfig.product || "N/A"}</span>
          </div>
          <div class="app-description">${
            appConfig.desc || "No description"
          }</div>
          ${
            appConfig.jobId
              ? `<div class="app-job-id">Job: ${appConfig.jobId}</div>`
              : ""
          }
        </div>
      `;
    }

    // Add GitLab correlations (environment-independent)
    if (gitlabCorrelations.length > 0) {
      html += `
        <div class="env-section">
          <div class="env-header">
            <span class="env-badge gitlab">GitLab</span>
            <span>Source Code</span>
          </div>
          ${gitlabCorrelations
            .map((correlation) => this.renderCorrelationItem(correlation))
            .join("")}
        </div>
      `;
    }

    // Add environment-specific correlations
    envNames.forEach((envName) => {
      const correlations = correlationsByEnv[envName];
      const envClass = envName.toLowerCase();

      html += `
        <div class="env-section">
          <div class="env-header">
            <span class="env-badge ${envClass}">${envName}</span>
            <span>${correlations.length} correlation${
        correlations.length !== 1 ? "s" : ""
      }</span>
          </div>
          ${correlations
            .map((correlation) => this.renderCorrelationItem(correlation))
            .join("")}
        </div>
      `;
    });

    correlationList.innerHTML = html;
  }

  renderCorrelationItem(correlation) {
    const metadataHtml = correlation.metadata
      ? `
      <div class="correlation-metadata">
        ${
          correlation.metadata.type
            ? `<span class="meta-tag">${correlation.metadata.type}</span>`
            : ""
        }
        ${
          correlation.metadata.product
            ? `<span class="meta-tag">${correlation.metadata.product}</span>`
            : ""
        }
      </div>
    `
      : "";

    return `
      <div class="correlation-item ${correlation.platform}" data-url="${correlation.url}">
        <div class="correlation-icon ${correlation.platform}">
          ${correlation.icon}
        </div>
        <div class="correlation-details">
          <div class="correlation-title">${correlation.title}</div>
          <div class="correlation-url">${correlation.url}</div>
          ${metadataHtml}
        </div>
      </div>
    `;
  }

  updateStatus(message, type = "info") {
    const statusElement = document.getElementById("status");
    statusElement.textContent = message;
    statusElement.className = `status ${type}`;

    setTimeout(() => {
      statusElement.textContent = "Ready";
      statusElement.className = "status";
    }, 3000);
  }

  startPageMonitoring() {
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

// Make sidebar globally accessible for event handlers
let sidebar;

document.addEventListener("DOMContentLoaded", () => {
  sidebar = new StackSyncSidebar();
});
