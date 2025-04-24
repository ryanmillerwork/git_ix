// Test comment to check edit functionality
import axios from 'axios';

export const GITHUB_OWNER = process.env.GITHUB_OWNER || 'homebase-sheinberg'; // Use env var or default
export const GITHUB_REPO = process.env.GITHUB_REPO || 'ess'; // Use env var or default
export const GITHUB_API_BASE = 'https://api.github.com';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME; // If using basic auth (less recommended)

// Prioritize Token Auth
export const githubAuthHeaders = GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {};
export const githubAxiosAuth = GITHUB_TOKEN ? undefined : (GITHUB_USERNAME ? { username: GITHUB_USERNAME, password: '' } : undefined); // Basic auth needs password, but PAT used in Authorization header is preferred

// --- GitHub Helper Functions ---

/**
 * Creates a lightweight tag reference on GitHub.
 */
export async function createTagReference(tagName: string, commitSha: string) {
  const createRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`;
  const refPayload = {
    ref: `refs/tags/${tagName}`,
    sha: commitSha,
  };
  console.log(`[GitHub] Attempting to create tag ref: ${refPayload.ref} pointing to SHA: ${commitSha}`);
  try {
    await axios.post(createRefUrl, refPayload, { headers: githubAuthHeaders });
    console.log(`[GitHub] Tag ref '${tagName}' created successfully.`);
    return { success: true };
  } catch (tagError: any) {
    console.error(`[GitHub] Error creating tag ref '${tagName}':`, tagError.response?.data || tagError.message);
    if (tagError.response?.status === 422) {
      return { success: false, error: `Tag '${tagName}' already exists.` };
    }
    return { success: false, error: 'Failed to create tag reference on GitHub.' };
  }
}

/**
 * Fetches a Git tree object.
 */
export async function getTree(treeSha: string, recursive: boolean = false): Promise<any[]> {
    const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${treeSha}${recursive ? '?recursive=1' : ''}`;
    console.log(`[GitHub] Fetching tree: ${treeSha} (Recursive: ${recursive})`);
    try {
         const response = await axios.get(url, { headers: githubAuthHeaders });
         if (!response.data || !Array.isArray(response.data.tree)) {
             throw new Error('Invalid tree data format received from GitHub');
         }
         return response.data.tree; // Returns array of children {path, mode, type, sha}
    } catch (error: any) {
         console.error(`[GitHub] Error fetching tree ${treeSha}:`, error.response?.data || error.message);
         throw new Error(`Failed to fetch tree data for SHA: ${treeSha}`);
    }
}

/**
 * Creates a Git tree object.
 */
export async function createTree(treeDefinition: any[]): Promise<string> {
    const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`;
    console.log(`[GitHub] Creating new tree... Definition size: ${treeDefinition.length}`);
    try {
        const response = await axios.post(url, { tree: treeDefinition }, { headers: githubAuthHeaders });
        console.log(`[GitHub] New tree created SHA: ${response.data.sha}`);
        return response.data.sha;
    } catch (error: any) {
        console.error(`[GitHub] Error creating tree:`, error.response?.data || error.message, "Definition (partial):", JSON.stringify(treeDefinition).substring(0, 200) + "...");
        throw new Error('Failed to create new tree object on GitHub.');
    }
}

/**
 * Gets the SHA of the latest commit on a branch.
 */
export async function getBranchHeadSha(branch: string): Promise<string> {
    const branchUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/branches/${encodeURIComponent(branch)}`;
    console.log(`[GitHub] Fetching branch details for: ${branch}`);
    try {
        const branchResponse = await axios.get(branchUrl, { headers: githubAuthHeaders });
        if (!branchResponse.data?.commit?.sha) {
            throw new Error('Invalid branch data received from GitHub');
        }
        const latestCommitSha = branchResponse.data.commit.sha;
        console.log(`[GitHub] Latest commit SHA for ${branch}: ${latestCommitSha}`);
        return latestCommitSha;
    } catch (error: any) {
        console.error(`[GitHub] Error fetching branch details for ${branch}:`, error.response?.data || error.message);
        if (error.response?.status === 404) {
            throw new Error(`Branch '${branch}' not found.`);
        }
        throw new Error(`Failed to fetch branch details for '${branch}'.`);
    }
}

/**
 * Gets the root tree SHA for a specific commit SHA.
 */
export async function getCommitTreeSha(commitSha: string): Promise<string> {
    const commitUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${commitSha}`;
    console.log(`[GitHub] Fetching commit details for: ${commitSha}`);
    try {
        const commitResponse = await axios.get(commitUrl, { headers: githubAuthHeaders });
         if (!commitResponse.data?.tree?.sha) {
            throw new Error('Invalid commit data received from GitHub');
        }
        const rootTreeSha = commitResponse.data.tree.sha;
        console.log(`[GitHub] Root tree SHA for commit ${commitSha}: ${rootTreeSha}`);
        return rootTreeSha;
    } catch (error: any) {
        console.error(`[GitHub] Error fetching commit details for ${commitSha}:`, error.response?.data || error.message);
         if (error.response?.status === 404) {
            throw new Error(`Commit '${commitSha}' not found.`);
        }
        throw new Error(`Failed to fetch commit details for '${commitSha}'.`);
    }
}
