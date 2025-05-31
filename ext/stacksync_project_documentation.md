# StackSync Chrome Extension - Project Documentation

## Project Overview

StackSync is a Chrome extension that provides intelligent correlation between development tools by extracting application names and creating cross-platform navigation links. Instead of manually searching for related resources across different platforms, the extension automatically detects what application you're working with and provides one-click access to related tools.

## Core Problem Statement

Development teams often work across multiple platforms:
- **Elastic/Kibana** for log analysis and monitoring
- **GitLab** for source code management
- **Jenkins** for CI/CD pipelines

The challenge is correlating information between these platforms. When debugging an issue in Elastic logs for `nimbus-codegen-service`, developers need to quickly access:
- The GitLab repository for that service
- The Jenkins job that builds/deploys it
- Configuration information about the service

Manual correlation is time-consuming and error-prone, especially with complex naming schemes and prefixed job names.

## Solution Architecture

### High-Level Approach

StackSync uses a **configuration-driven correlation system** rather than simple name-based matching:

1. **Platform Detection**: Identifies which development tool you're currently using
2. **Application Name Extraction**: Intelligently extracts the real application name from URLs, DOM elements, or API calls
3. **Configuration Service Integration**: Fetches application metadata from a centralized config service
4. **Dynamic URL Generation**: Uses service APIs to generate accurate links to related platforms

### Key Architecture Principles

- **API-Driven**: Uses existing infrastructure services rather than hardcoded patterns
- **Configurable**: Adapts to different environments and URL structures
- **Robust Fallbacks**: Multiple detection strategies with graceful degradation
- **Real Relationships**: Uses actual configuration data rather than assumptions

## Core Components

### 1. Platform Detection (`detectPlatform`)

**Purpose**: Identifies which development platform the user is currently viewing.

**Implementation Strategy**:
- **Primary**: Matches against user-configured URLs for accurate detection
- **Secondary**: Generic hostname pattern matching 
- **Tertiary**: URL path pattern recognition

**Configuration Examples**:
```javascript
elasticUrl: "https://myelastic.dev:9243"
gitlabUrl: "https://nyssc.svc.ny.gov" 
jenkinsUrl: "https://jenkins-internal.company.com"
```

**Supported Platforms**:
- **Elastic/Kibana**: Detects from configured URL + patterns like `/app/discover`
- **GitLab**: Detects from configured URL + patterns like `/-/`, `/merge_requests`
- **Jenkins**: Detects from configured URL + patterns like `/job/`, `/build/`

### 2. Application Name Extraction

**Purpose**: Extracts the real application name from the current platform.

#### Elastic/Kibana Extraction
- **URL Parsing**: Extracts from complex Elastic URLs with encoded filters
- **Pattern Matching**: Looks for `kubernetes.deployment.name` in URL parameters
- **Example URL**:
  ```
  https://myelastic.dev:9243/s/org_space_developers/app/discover#/?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-1h,to:now))&_a=(columns:!(message),filters:!((%27$state%27:(store:appState),meta:(alias:!n,disabled:!f,field:kubernetes.deployment.name,index:%2777fb805f-9c8b-4193-a8fa-941d2e9d770e%27,key:kubernetes.deployment.name,negate:!f,params:(query:nimbus-codegen-service),type:phrase),query:(match_phrase:(kubernetes.deployment.name:nimbus-codegen-service))))
  ```
- **Extracted Name**: `nimbus-codegen-service`

#### GitLab Extraction
- **URL Structure Analysis**: Handles complex subgroup structures
- **Pattern**: `/group/subgroup/project/-/path` → extracts `project`
- **Example**: `/DTF/FRAMEWORK/NIMBUS/nimbus-saml-service/-/issues` → `nimbus-saml-service`

#### Jenkins Extraction
- **Config.xml Parsing**: Fetches Jenkins job configuration to extract real app name
- **API Call**: `GET {jenkins-url}/job/{job-name}/config.xml`
- **Pattern Extraction**: Parses pipeline script for `def _appName='actual-name'`
- **Example Job**: `fwrk-dev-nimbus-codegen-service` → Real App: `nimbus-codegen-service`

### 3. Configuration Service Integration

**Purpose**: Fetches authoritative application metadata and relationships.

**API Endpoint**: `http://config-service.dev/app-config/config/artifact/app/{appName}`

**Sample Response**:
```json
{
  "id": "nimbus-saml-service",
  "type": "FWRK-SERVICE",
  "desc": "Generates And validates SAML; Clone of ESRV",
  "product": "FWRK",
  "jobId": "fwrk-dev-nimbus-saml-service",
  "config": "{\"implType\":\"MicroProfile\",\"depType\":\"RunTime\",\"appJobId\":\"fwrk-dev-nimbus-saml-service\",\"repoCreatedThisRun\":\"true\",\"id\":\"11469\",\"interfaceName\":\"\",\"url\":\"git@nyssc.svc.ny.gov:DTF/FRAMEWORK/NIMBUS/nimbus-saml-service.git\"}",
  "gitURL": "git@nyssc.svc.ny.gov:DTF/FRAMEWORK/NIMBUS/nimbus-saml-service.git",
  "dependencies": [
    {
      "id": "SAML_VALIDATION_PROPERTIES",
      "type": "PROPERTY-SET"
    }
  ]
}
```

**Key Fields Used**:
- `jobId`: Real Jenkins job name for accurate linking
- `gitURL`: Authoritative Git repository URL
- `product`: Used for environment-specific Elastic URL generation
- `type`, `desc`: Displayed in sidebar for context

### 4. Dynamic URL Generation

#### Elastic URL Service
**Purpose**: Generates environment-specific Elastic URLs dynamically.

**API Endpoint**: `https://nimbus-elastic-search.dev/elastic-search/api/elastic-search/get-elastic-url?appName={app}&appProduct={product}&envID={env}`

**Parameters**:
- `appName`: Application name (e.g., `nimbus-saml-service`)
- `appProduct`: Product code from config service (e.g., `FWRK`)
- `envID`: Target environment (`DEV`, `TEST`, `PROD`)

**Returns**: Complete Elastic URL with proper filters and time ranges

#### GitLab URL Conversion
**Purpose**: Converts SSH Git URLs to web interface URLs.

**Conversion Logic**:
```javascript
// Input: git@nyssc.svc.ny.gov:DTF/FRAMEWORK/NIMBUS/nimbus-saml-service.git
// Output: https://nyssc.svc.ny.gov/DTF/FRAMEWORK/NIMBUS/nimbus-saml-service
```

#### Jenkins URL Construction
**Purpose**: Builds Jenkins job URLs from configuration data.

**Pattern**: `{jenkins-base-url}/job/{jobId}/`
**Example**: `https://jenkins.com/job/fwrk-dev-nimbus-saml-service/`

## User Interface Components

### Sidebar Layout
- **Header**: Shows StackSync branding and status
- **Current Context**: Displays detected platform and application name
- **App Information**: Shows metadata from config service (type, product, description)
- **Correlations List**: Clickable links to related platforms
- **Settings Panel**: Configuration interface

### Correlation Items
Each correlation shows:
- **Platform Icon**: Visual identifier (E for Elastic, G for GitLab, J for Jenkins)
- **Title**: Descriptive action ("View Logs in Elastic")
- **URL**: Full target URL (truncated for display)
- **Metadata**: Additional context when available

### Settings Configuration
Required settings for full functionality:
- **Config Service URL**: `http://config-service.dev`
- **Elastic Search Service URL**: `https://nimbus-elastic-search.dev`
- **Environment**: `DEV`/`TEST`/`PROD`
- **Platform URLs**: For detection and fallback linking

## Implementation Details

### Chrome Extension Architecture

**Manifest v3 Structure**:
- `manifest.json`: Permissions and configuration
- `background.js`: Service worker for tab monitoring
- `sidebar.js`: Main correlation logic
- `index.html`: Sidebar interface
- Side panel API for persistent sidebar

**Required Permissions**:
- `sidePanel`: Chrome side panel API
- `storage`: Settings persistence
- `tabs`: Current tab access
- `scripting`: Content script injection
- `contextMenus`: Right-click integration
- `<all_urls>`: Cross-platform access

### Error Handling Strategy

**Graceful Degradation**:
1. **Config Service Unavailable**: Falls back to name-based URL construction
2. **Elastic Service Unavailable**: Uses static Elastic URL with basic filters
3. **Git URL Conversion Fails**: Uses configured GitLab fallback URL
4. **Jenkins Config.xml Inaccessible**: Uses job name from URL
5. **Platform Detection Fails**: Shows "Unknown" but still attempts correlation

**User Feedback**:
- Status messages in sidebar header
- Loading indicators during API calls
- Error messages with actionable guidance

### Performance Considerations

**Optimization Strategies**:
- API calls only triggered when platform/app changes
- Settings cached in Chrome storage
- Minimal DOM queries with efficient selectors
- Background monitoring throttled to 2-second intervals

**Resource Management**:
- Single fetch per config service call
- Reuses extracted app names across correlation generation
- Lazy loading of non-critical correlations

## Development Environment Setup

### File Structure
```
stacksync-extension/
├── manifest.json
├── index.html
├── css/
│   └── index.css
├── js/
│   ├── background.js
│   └── sidebar.js
└── icons/
    └── icon.png
```

### Installation Process
1. Create extension directory with all files
2. Add icon file (`icon.png`) to `icons/` directory
3. Open Chrome Developer Mode
4. Load as unpacked extension
5. Configure service URLs in settings
6. Test on each supported platform

### Testing Scenarios
- **Elastic**: Visit with `kubernetes.deployment.name` filter
- **GitLab**: Navigate to project with subgroups
- **Jenkins**: View job with prefixed name
- **Cross-platform**: Verify correlation links work bidirectionally

## Configuration Examples

### Production Setup
```javascript
configServiceUrl: "http://config-service.prod"
elasticSearchServiceUrl: "https://nimbus-elastic-search.prod"
elasticUrl: "https://elastic.company.com:9243"
gitlabUrl: "https://gitlab.company.com"
jenkinsUrl: "https://jenkins.company.com"
environment: "PROD"
```

### Development Setup
```javascript
configServiceUrl: "http://config-service.dev"
elasticSearchServiceUrl: "https://nimbus-elastic-search.dev"
elasticUrl: "https://myelastic.dev:9243"
gitlabUrl: "https://nyssc.svc.ny.gov"
jenkinsUrl: "https://jenkins-dev.company.com"
environment: "DEV"
```

## Extension Points and Customization

### Adding New Platforms
1. **Update `detectPlatform()`**: Add URL/hostname patterns
2. **Add Content Script Function**: Create extraction logic
3. **Implement URL Builder**: Add correlation URL generation
4. **Update UI**: Add platform icon and styling

### Custom Naming Patterns
- **Config Service Integration**: Modify API parsing logic
- **URL Pattern Recognition**: Update regex patterns
- **Fallback Strategies**: Add environment-specific rules

### API Integration Points
- **Authentication**: Add headers/tokens for secure APIs
- **Response Transformation**: Handle different API response formats
- **Caching Strategy**: Implement response caching for performance

## Troubleshooting Guide

### Common Issues

**"No project detected"**:
- Check platform detection configuration
- Verify URL patterns match your infrastructure
- Test content script extraction manually

**"App not found in config service"**:
- Verify config service URL and accessibility
- Check extracted app name accuracy
- Test API endpoint directly

**"Error loading correlations"**:
- Check browser console for detailed errors
- Verify all service URLs are accessible
- Test individual API endpoints

**Platform not detected**:
- Update platform URLs in settings
- Check URL pattern matching logic
- Verify hostname/path patterns

### Debug Information
- Browser console logs show extraction details
- Settings panel validates configuration
- Status messages indicate current operation state
- Network tab shows API call success/failure

## Future Enhancement Opportunities

### Feature Additions
- **Multi-environment switching**: Quick environment toggle
- **Dependency visualization**: Show app dependency graph
- **Historical correlation**: Recently accessed correlations
- **Custom correlation rules**: User-defined platform additions

### Integration Possibilities
- **Slack integration**: Post correlation summaries
- **Jira integration**: Link tickets to technical resources
- **Monitoring tools**: Grafana, Datadog correlation
- **Documentation platforms**: Confluence, wiki integration

### Performance Improvements
- **Background caching**: Pre-fetch common correlations
- **Intelligent prefetching**: Predict likely correlations
- **Batch API calls**: Reduce request overhead
- **Service worker optimization**: Improve background processing

This documentation provides a comprehensive understanding of the StackSync extension's architecture, implementation details, and operational characteristics. The extension serves as an intelligent development tool that eliminates manual correlation tasks by leveraging existing infrastructure APIs and configuration services.