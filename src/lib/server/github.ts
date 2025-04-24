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
  } catch (err: unknown) {
    let message = 'Failed to create tag reference on GitHub.';
    if (axios.isAxiosError(err)) {
        const respData = err.response?.data as { message?: string } | undefined;
        message = respData?.message ?? err.message;
         if (err.response?.status === 422) {
             message = `Tag '${tagName}' already exists.`;
         }
         console.error(`[GitHub] AxiosError creating tag ref '${tagName}':`, message);
     } else if (err instanceof Error) {
          message = err.message;
          console.error(`[GitHub] Error creating tag ref '${tagName}':`, message);
     } else {
         console.error(`[GitHub] Unknown error creating tag ref '${tagName}':`, err);
     }
    return { success: false, error: message };
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
    } catch (err: unknown) {
        let errorMsg = `Failed to fetch tree data for SHA: ${treeSha}`;
        if (axios.isAxiosError(err)) {
            const respData = err.response?.data as { message?: string } | undefined;
            errorMsg = respData?.message ?? err.message;
            console.error(`[GitHub] AxiosError fetching tree ${treeSha}:`, errorMsg);
        } else if (err instanceof Error) {
             errorMsg = err.message;
             console.error(`[GitHub] Error fetching tree ${treeSha}:`, errorMsg);
        } else {
             console.error(`[GitHub] Unknown error fetching tree ${treeSha}:`, err);
        }
        throw new Error(errorMsg);
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
    } catch (err: unknown) {
        let errorMsg = 'Failed to create new tree object on GitHub.';
        if (axios.isAxiosError(err)) {
            const respData = err.response?.data as { message?: string } | undefined;
            errorMsg = respData?.message ?? err.message;
            console.error(`[GitHub] AxiosError creating tree:`, errorMsg, "Definition (partial):", JSON.stringify(treeDefinition).substring(0, 200) + "...");
        } else if (err instanceof Error) {
             errorMsg = err.message;
             console.error(`[GitHub] Error creating tree:`, errorMsg, "Definition (partial):", JSON.stringify(treeDefinition).substring(0, 200) + "...");
        } else {
             console.error(`[GitHub] Unknown error creating tree:`, err, "Definition (partial):", JSON.stringify(treeDefinition).substring(0, 200) + "...");
        }
        throw new Error(errorMsg);
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
    } catch (err: unknown) {
        let errorMsg = `Failed to fetch branch details for '${branch}'.`;
        if (axios.isAxiosError(err)) {
             const respData = err.response?.data as { message?: string } | undefined;
             errorMsg = respData?.message ?? err.message;
              if (err.response?.status === 404) {
                  errorMsg = `Branch '${branch}' not found.`;
              }
             console.error(`[GitHub] AxiosError fetching branch details for ${branch}:`, errorMsg);
         } else if (err instanceof Error) {
              errorMsg = err.message;
               console.error(`[GitHub] Error fetching branch details for ${branch}:`, errorMsg);
         } else {
              console.error(`[GitHub] Unknown error fetching branch details for ${branch}:`, err);
         }
        throw new Error(errorMsg);
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
    } catch (err: unknown) {
        let errorMsg = `Failed to fetch commit details for '${commitSha}'.`;
        if (axios.isAxiosError(err)) {
             const respData = err.response?.data as { message?: string } | undefined;
             errorMsg = respData?.message ?? err.message;
              if (err.response?.status === 404) {
                 errorMsg = `Commit '${commitSha}' not found.`;
             }
              console.error(`[GitHub] AxiosError fetching commit details for ${commitSha}:`, errorMsg);
          } else if (err instanceof Error) {
               errorMsg = err.message;
                console.error(`[GitHub] Error fetching commit details for ${commitSha}:`, errorMsg);
          } else {
               console.error(`[GitHub] Unknown error fetching commit details for ${commitSha}:`, err);
          }
        throw new Error(errorMsg);
    }
}
