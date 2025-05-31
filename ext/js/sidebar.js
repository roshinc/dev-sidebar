class StackSyncSidebar {
  constructor() {
    this.settings = {
      elasticUrl: "",
      gitlabUrl: "",
      jenkinsUrl: "",
      namingPattern: "",
      configServiceUrl: "",
      elasticSearchServiceUrl: "",
      environment: "DEV",
    };
    this.currentProject = null;
    this.currentPlatform = null;
    this.environments = ["DEV", "TEST", "PROD"]; // All supported environments

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
        "configServiceUrl",
        "elasticSearchServiceUrl",
        "environment",
      ]);

      this.settings = {
        elasticUrl: result.elasticUrl || "",
        gitlabUrl: result.gitlabUrl || "",
        jenkinsUrl: result.jenkinsUrl || "",
        namingPattern: result.namingPattern || "",
        configServiceUrl: result.configServiceUrl || "",
        elasticSearchServiceUrl: result.elasticSearchServiceUrl || "",
        environment: result.environment || "DEV",
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
    document.getElementById("configServiceUrl").value =
      this.settings.configServiceUrl;
    document.getElementById("elasticSearchServiceUrl").value =
      this.settings.elasticSearchServiceUrl;
    document.getElementById("environment").value = this.settings.environment;
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
    this.settings.configServiceUrl = document
      .getElementById("configServiceUrl")
      .value.trim();
    this.settings.elasticSearchServiceUrl = document
      .getElementById("elasticSearchServiceUrl")
      .value.trim();
    this.settings.environment = document
      .getElementById("environment")
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
    const fullUrl = url.href.toLowerCase();

    // Check against configured URLs first
    if (this.settings.elasticUrl) {
      try {
        const elasticHost = new URL(
          this.settings.elasticUrl
        ).hostname.toLowerCase();
        if (hostname === elasticHost || hostname.includes(elasticHost)) {
          return "elastic";
        }
      } catch (error) {
        // Invalid elastic URL in settings
      }
    }

    if (this.settings.jenkinsUrl) {
      try {
        const jenkinsHost = new URL(
          this.settings.jenkinsUrl
        ).hostname.toLowerCase();
        if (hostname === jenkinsHost || hostname.includes(jenkinsHost)) {
          return "jenkins";
        }
      } catch (error) {
        // Invalid jenkins URL in settings
      }
    }

    // Check GitLab by URL pattern since it might be a project URL
    if (this.settings.gitlabUrl) {
      try {
        const gitlabHost = new URL(
          this.settings.gitlabUrl
        ).hostname.toLowerCase();
        if (hostname === gitlabHost || hostname.includes(gitlabHost)) {
          return "gitlab";
        }
      } catch (error) {
        // Invalid gitlab URL in settings
      }
    }

    // Fallback to generic detection for common platforms
    if (hostname.includes("elastic") || hostname.includes("kibana")) {
      return "elastic";
    } else if (hostname.includes("gitlab")) {
      return "gitlab";
    } else if (hostname.includes("jenkins")) {
      return "jenkins";
    }

    // Additional platform detection patterns
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
      // Execute content script to extract project information for other platforms
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
          // First try to extract from URL (for cases like the provided example)
          const url = window.location.href;

          // Look for kubernetes.deployment.name in URL-encoded filters
          let deploymentMatch = url.match(
            /kubernetes\.deployment\.name[^)]*query:([^)]+)\)/i
          );
          if (deploymentMatch) {
            return decodeURIComponent(deploymentMatch[1]).replace(/['"]/g, "");
          }

          // Look for match_phrase deployment name
          deploymentMatch = url.match(
            /match_phrase.*kubernetes\.deployment\.name:([^)]+)\)/i
          );
          if (deploymentMatch) {
            return decodeURIComponent(deploymentMatch[1]).replace(/['"]/g, "");
          }

          // Look for kubernetes.deployment.name filter in the DOM
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

          // Look for filter pills/badges
          const filterBadges = document.querySelectorAll(
            '[class*="filter"], [class*="badge"]'
          );
          for (const badge of filterBadges) {
            const text = badge.textContent || badge.innerText || "";
            if (text.includes("kubernetes.deployment.name")) {
              const match = text.match(
                /kubernetes\.deployment\.name[:\s]*([a-zA-Z0-9\-_.]+)/i
              );
              if (match) {
                return match[1];
              }
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

          // Look for deployment name in page content
          const pageText = document.body.textContent || "";
          const deploymentNameMatch = pageText.match(
            /deployment[:\s]*([a-zA-Z0-9\-_.]+)/i
          );
          return deploymentNameMatch ? deploymentNameMatch[1] : null;
        };

      case "gitlab":
        return () => {
          // Extract project name from GitLab URL structure
          // Handle URLs like: /group/subgroup/project/-/issues
          // or: /group/project/-/merge_requests
          const url = window.location.href;
          const pathname = window.location.pathname;

          // Look for the /-/ separator which indicates GitLab-specific paths
          const gitlabSeparatorIndex = pathname.indexOf("/-/");
          if (gitlabSeparatorIndex > 0) {
            // Get the path before /-/ and extract the last segment as project name
            const projectPath = pathname.substring(0, gitlabSeparatorIndex);
            const pathParts = projectPath
              .split("/")
              .filter((part) => part.length > 0);
            if (pathParts.length > 0) {
              return pathParts[pathParts.length - 1]; // Last segment is the project name
            }
          }

          // Fallback: try breadcrumb navigation
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

          // Try project header elements
          const projectName = document.querySelector(
            '[data-testid="project-name"]'
          );
          if (projectName) {
            return projectName.textContent.trim();
          }

          // Try project title in header
          const projectTitle = document.querySelector(".project-title");
          if (projectTitle) {
            return projectTitle.textContent.trim();
          }

          // Final fallback: extract from URL path (assuming last segment before any query/hash)
          const pathSegments = pathname
            .split("/")
            .filter((part) => part.length > 0);
          if (pathSegments.length > 0) {
            return pathSegments[pathSegments.length - 1];
          }

          return null;
        };

      case "jenkins":
        return async () => {
          // First try to get app name from config.xml
          try {
            const currentUrl = window.location.href;
            let configUrl;

            // Build config.xml URL from current Jenkins page URL
            if (currentUrl.includes("/job/")) {
              // Extract job name and build config URL
              const jobMatch = currentUrl.match(/\/job\/([^\/]+)/);
              if (jobMatch) {
                const jobName = jobMatch[1];
                const baseUrl = currentUrl.split("/job/")[0];
                configUrl = `${baseUrl}/job/${jobName}/config.xml`;

                // Fetch config.xml
                const response = await fetch(configUrl);
                if (response.ok) {
                  const xmlText = await response.text();

                  // Parse XML
                  const parser = new DOMParser();
                  const xmlDoc = parser.parseFromString(xmlText, "text/xml");

                  // Check if we have a pipeline script
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

          // Fallback: Extract job name from DOM
          const jobName = document.querySelector("#main-panel h1");
          if (jobName) {
            const text = jobName.textContent.trim();
            // Remove "Project " or "Job " prefix if present
            return text.replace(/^(Project|Job)\s+/, "");
          }

          // Try breadcrumb as final fallback
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
        case "elastic":
          // For Elastic URLs, try to extract from URL parameters first
          const fullUrl = url;

          // Look for kubernetes.deployment.name in various URL formats
          let deploymentMatch = fullUrl.match(
            /kubernetes\.deployment\.name[^)]*query:([^)]+)\)/i
          );
          if (deploymentMatch) {
            return decodeURIComponent(deploymentMatch[1]).replace(/['"]/g, "");
          }

          // Look for match_phrase deployment name
          deploymentMatch = fullUrl.match(
            /match_phrase.*kubernetes\.deployment\.name:([^)]+)\)/i
          );
          if (deploymentMatch) {
            return decodeURIComponent(deploymentMatch[1]).replace(/['"]/g, "");
          }

          // Try URL parameters
          const params = new URLSearchParams(urlObj.search);
          for (const [key, value] of params) {
            if (key.includes("deployment") || key.includes("app")) {
              return value;
            }
          }

          // Try to find in fragment/hash
          if (urlObj.hash) {
            const hashMatch = urlObj.hash.match(
              /kubernetes\.deployment\.name[^)]*query:([^)]+)\)/i
            );
            if (hashMatch) {
              return decodeURIComponent(hashMatch[1]).replace(/['"]/g, "");
            }
          }
          break;

        case "gitlab":
          // GitLab URLs with subgroups: /group/subgroup/project or /group/subgroup/project/-/issues
          // Extract project name as the last segment before /-/ or end of path
          const gitlabSeparatorIndex = pathParts.indexOf("-");
          let projectPath;

          if (gitlabSeparatorIndex > 0) {
            // Get path before /-/ separator
            projectPath = pathParts.slice(0, gitlabSeparatorIndex);
          } else {
            // No /-/ separator, use all path parts
            projectPath = pathParts;
          }

          if (projectPath.length > 0) {
            return projectPath[projectPath.length - 1]; // Last segment is project name
          }
          break;

        case "jenkins":
          // For Jenkins, try to extract real app name from config.xml
          try {
            const jobMatch = urlObj.pathname.match(/\/job\/([^\/]+)/);
            if (jobMatch) {
              const jobName = jobMatch[1];
              const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
              const configUrl = `${baseUrl}/job/${jobName}/config.xml`;

              // We can't make async calls here, so we'll need to handle this in the content script
              // For now, return the job name as fallback
              return jobName;
            }
          } catch (error) {
            console.error("Error extracting Jenkins job from URL:", error);
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
      // Get app configuration from config service
      const appConfig = await this.fetchAppConfig(this.currentProject);

      if (!appConfig) {
        correlationList.innerHTML =
          '<div class="no-correlations">App not found in config service</div>';
        this.updateStatus("App not found in config service", "warning");
        return;
      }

      const correlations = [];

      // Generate Elastic correlations for ALL environments
      if (
        this.settings.elasticSearchServiceUrl &&
        this.currentPlatform !== "elastic"
      ) {
        for (const env of this.environments) {
          try {
            const elasticUrl = await this.fetchElasticUrl(
              this.currentProject,
              appConfig.product,
              env
            );
            if (elasticUrl) {
              correlations.push({
                platform: "elastic",
                title: `View ${env} Logs in Elastic`,
                url: elasticUrl,
                icon: "E",
                environment: env,
                isCurrent: env === this.settings.environment,
              });
            }
          } catch (error) {
            console.error(`Error fetching ${env} Elastic URL:`, error);
          }
        }
      }

      // Generate GitLab correlation (environment-independent)
      if (appConfig.gitURL && this.currentPlatform !== "gitlab") {
        const gitlabUrl = this.convertGitUrlToWebUrl(appConfig.gitURL);
        if (gitlabUrl) {
          correlations.push({
            platform: "gitlab",
            title: "View in GitLab",
            url: gitlabUrl,
            icon: "G",
          });
        }
      }

      // Generate Jenkins correlations for ALL environments
      if (this.settings.jenkinsUrl && this.currentPlatform !== "jenkins") {
        for (const env of this.environments) {
          const jenkinsJobId = this.getEnvironmentJobId(appConfig.jobId, env);
          if (jenkinsJobId) {
            const jenkinsUrl = this.buildJenkinsUrlFromJobId(jenkinsJobId);
            correlations.push({
              platform: "jenkins",
              title: `View ${env} Job in Jenkins`,
              url: jenkinsUrl,
              icon: "J",
              environment: env,
              isCurrent: env === this.settings.environment,
            });
          }
        }
      }

      // Add app config info
      correlations.push({
        platform: "config",
        title: "View App Configuration",
        url: `${this.settings.configServiceUrl}/${this.currentProject}`,
        icon: "C",
        metadata: {
          type: appConfig.type,
          product: appConfig.product,
          description: appConfig.desc,
        },
      });

      this.renderCorrelations(correlations, appConfig);
      this.updateStatus(`Found ${correlations.length} correlations`, "success");
    } catch (error) {
      console.error("Error generating correlations:", error);
      correlationList.innerHTML =
        '<div class="no-correlations">Error loading correlations</div>';
      this.updateStatus("Error loading correlations", "error");
    }
  }

  async fetchAppConfig(appName) {
    if (!this.settings.configServiceUrl) {
      throw new Error("Config service URL not configured");
    }

    try {
      const url = `${this.settings.configServiceUrl}/${appName}`;
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          return null; // App not found
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
      const url = `${this.settings.elasticSearchServiceUrl}?appName=${appName}&appProduct=${appProduct}&envID=${environment}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const elasticUrl = await response.text();
      return elasticUrl.trim();
    } catch (error) {
      console.error(`Error fetching ${environment} Elastic URL:`, error);
      return null;
    }
  }

  getEnvironmentJobId(baseJobId, environment) {
    if (!baseJobId) return null;

    // If the jobId already contains environment info, replace it
    // Example: "fwrk-dev-nimbus-codegen-service" -> "fwrk-prod-nimbus-codegen-service"
    const envPattern = /-(dev|test|prod)-/i;
    if (envPattern.test(baseJobId)) {
      return baseJobId.replace(envPattern, `-${environment.toLowerCase()}-`);
    }

    // If no environment in jobId, try to insert it after the product prefix
    // Example: "fwrk-nimbus-codegen-service" -> "fwrk-dev-nimbus-codegen-service"
    const parts = baseJobId.split("-");
    if (parts.length >= 2) {
      return `${parts[0]}-${environment.toLowerCase()}-${parts
        .slice(1)
        .join("-")}`;
    }

    // Fallback: append environment
    return `${baseJobId}-${environment.toLowerCase()}`;
  }

  buildJenkinsUrlFromJobId(jobId) {
    const baseUrl = this.settings.jenkinsUrl.replace(/\/$/, "");
    return `${baseUrl}/job/${jobId}/`;
  }

  convertGitUrlToWebUrl(gitUrl) {
    try {
      // Convert SSH git URL to HTTPS web URL
      // From: git@gitlab.com:GROUP/SUBGROUP/nimbus-saml-service.git
      // To: https://gitlab.com/GROUP/SUBGROUP/nimbus-saml-service

      if (gitUrl.startsWith("git@")) {
        const match = gitUrl.match(/git@([^:]+):(.+)\.git$/);
        if (match) {
          const [, host, path] = match;
          return `https://${host}/${path}`;
        }
      } else if (gitUrl.startsWith("https://")) {
        // Already a web URL, just remove .git suffix
        return gitUrl.replace(/\.git$/, "");
      }

      return null;
    } catch (error) {
      console.error("Error converting git URL:", error);
      return null;
    }
  }

  renderCorrelations(correlations, appConfig = null) {
    const correlationList = document.getElementById("correlationList");

    if (correlations.length === 0) {
      correlationList.innerHTML =
        '<div class="no-correlations">Configure services in settings to see correlations</div>';
      return;
    }

    let html = "";

    // Add app info section if we have config
    if (appConfig) {
      html += `
        <div class="app-info">
          <div class="app-info-header">
            <span class="app-type">${appConfig.type}</span>
            <span class="app-product">${appConfig.product}</span>
          </div>
          <div class="app-description">${
            appConfig.desc || "No description"
          }</div>
          ${
            appConfig.jobId
              ? `<div class="app-job-id">Base Job: ${appConfig.jobId}</div>`
              : ""
          }
        </div>
      `;
    }

    // Group correlations by platform for better organization
    const groupedCorrelations = this.groupCorrelationsByPlatform(correlations);

    // Render each platform group
    for (const [platform, items] of Object.entries(groupedCorrelations)) {
      if (platform === "config") {
        // Render config item separately at the end
        continue;
      }

      html += `<div class="platform-group">`;

      if (items.length > 1) {
        html += `<div class="platform-group-header">${this.getPlatformDisplayName(
          platform
        )}</div>`;
      }

      html += items
        .map((correlation) => {
          const envClass = correlation.environment
            ? `env-${correlation.environment.toLowerCase()}`
            : "";
          const currentClass = correlation.isCurrent ? "current-env" : "";

          const metadataHtml = correlation.metadata
            ? `<div class="correlation-metadata">
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
        </div>`
            : "";

          const envBadgeHtml = correlation.environment
            ? `<span class="env-badge ${envClass} ${currentClass}">${correlation.environment}</span>`
            : "";

          return `
        <div class="correlation-item ${correlation.platform} ${envClass} ${currentClass}" data-url="${correlation.url}">
          <div class="correlation-icon ${correlation.platform}">
            ${correlation.icon}
          </div>
          <div class="correlation-details">
            <div class="correlation-title-row">
              <div class="correlation-title">${correlation.title}</div>
              ${envBadgeHtml}
            </div>
            <div class="correlation-url">${correlation.url}</div>
            ${metadataHtml}
          </div>
        </div>
      `;
        })
        .join("");

      html += `</div>`;
    }

    // Add config correlation at the end
    if (groupedCorrelations.config) {
      html += groupedCorrelations.config
        .map((correlation) => {
          const metadataHtml = correlation.metadata
            ? `<div class="correlation-metadata">
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
        </div>`
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
        })
        .join("");
    }

    correlationList.innerHTML = html;
  }

  groupCorrelationsByPlatform(correlations) {
    const grouped = {};

    for (const correlation of correlations) {
      const platform = correlation.platform;
      if (!grouped[platform]) {
        grouped[platform] = [];
      }
      grouped[platform].push(correlation);
    }

    // Sort environments within each platform (DEV, TEST, PROD)
    for (const platform in grouped) {
      if (platform !== "gitlab" && platform !== "config") {
        grouped[platform].sort((a, b) => {
          const envOrder = { DEV: 0, TEST: 1, PROD: 2 };
          return (
            (envOrder[a.environment] || 999) - (envOrder[b.environment] || 999)
          );
        });
      }
    }

    return grouped;
  }

  getPlatformDisplayName(platform) {
    const displayNames = {
      elastic: "Elastic/Kibana",
      jenkins: "Jenkins",
      gitlab: "GitLab",
      config: "Configuration",
    };
    return displayNames[platform] || platform;
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
