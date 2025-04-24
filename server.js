// server.js
require('dotenv').config();
const express = require('express');
const next    = require('next');
const cors = require('cors');
const axios = require('axios');
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const semver = require('semver'); // Use semver library for robust version handling
const Diff = require('diff'); // Add the diff library

const dev       = process.env.NODE_ENV !== 'production';
const NEXT_APP  = next({ dev });
const handle    = NEXT_APP.getRequestHandler();

const app = express();
const PORT = process.env.PORT || 3000;

// Increase payload size limit for JSON requests (e.g., for file uploads)
app.use(express.json({ limit: '50mb' })); 
// Also increase limit for URL-encoded data if needed (though likely not the issue here)
app.use(express.urlencoded({ limit: '50mb', extended: true })); 

app.use(cors());           // Allow all origins (for development purposes)

// GitHub repo details
const GITHUB_OWNER = 'homebase-sheinberg';
const GITHUB_REPO = 'ess'; // Changed from dserv
const GITHUB_API_BASE = 'https://api.github.com';

// Use a GitHub token if provided to increase API rate limits.
// const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const githubHeaders = GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {};

// --- Helper Functions for Versioning ---

// Finds the latest valid semantic version tag from a list of tag objects
function getLatestSemanticTag(tags) {
  if (!Array.isArray(tags)) return null;

  const validTags = tags
    .map(tag => tag.name)
    .filter(name => semver.valid(name))
    .sort(semver.rcompare); // Sorts descending (latest first)

  return validTags.length > 0 ? validTags[0] : null;
}

// Increments a semantic version string based on the bump type
function incrementVersion(versionString, bumpType) {
  if (!semver.valid(versionString)) {
    console.warn(`[incrementVersion] Invalid version string: ${versionString}, defaulting to 1.0.0`);
    // Default based on bump type if starting from scratch
    if (bumpType === 'major') return '1.0.0';
    if (bumpType === 'minor') return '0.1.0';
    return '0.0.1'; // Default to patch if invalid input or patch type
  }
  // semver.inc automatically handles pre-release etc. if needed, but we'll keep it simple
  const nextVersion = semver.inc(versionString, bumpType);
  return nextVersion || versionString; // Fallback to original if inc fails
}

// Helper to create a lightweight tag reference
async function createTagReference(tagName, commitSha, auth) {
  const createRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`;
  const refPayload = {
    ref: `refs/tags/${tagName}`,
    sha: commitSha,
  };
  console.log(`[createTagReference] Attempting to create tag ref: ${refPayload.ref} pointing to SHA: ${commitSha}`);
  try {
    await axios.post(createRefUrl, refPayload, { auth });
    console.log(`[createTagReference] Tag ref '${tagName}' created successfully.`);
    return { success: true };
  } catch (tagError) {
    console.error(`[createTagReference] Error creating tag ref '${tagName}':`, tagError.response?.data || tagError.message);
    // Check for specific GitHub errors (e.g., ref already exists)
    if (tagError.response?.status === 422) {
      return { success: false, error: `Tag '${tagName}' already exists.` };
    }
    return { success: false, error: 'Failed to create tag reference on GitHub.' };
  }
}

// --- Helper Functions (ensure these are defined or imported) ---
async function getTree(treeSha, headers) {
    const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${treeSha}`;
    console.log(`[getTree] Fetching tree: ${treeSha}`);
    try {
         const response = await axios.get(url, { headers });
         return response.data.tree; // Returns array of children {path, mode, type, sha}
    } catch (error) {
         console.error(`[getTree] Error fetching tree ${treeSha}:`, error.response?.data || error.message);
         throw new Error(`Failed to fetch tree data for SHA: ${treeSha}`);
    }
};

async function createTree(treeDefinition, headers) {
    const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`;
    console.log(`[createTree] Creating new tree... Definition size: ${treeDefinition.length}`);
    try {
        const response = await axios.post(url, { tree: treeDefinition }, { headers });
        console.log(`[createTree] New tree created SHA: ${response.data.sha}`);
        return response.data.sha;
    } catch (error) {
        console.error(`[createTree] Error creating tree:`, error.response?.data || error.message, "Definition:", JSON.stringify(treeDefinition).substring(0, 500) + "..."); // Log part of definition
        throw new Error('Failed to create new tree object on GitHub.');
    }
};

// ----------------------------------------
// API endpoints
// GETs
// ----------------------------------------

// --- NEW: GET /health - Basic health check --- 
app.get('/health', (req, res) => {
  // This endpoint simply confirms the server is running and responding.
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /branches - Returns all branches in the GitHub repo
app.get('/branches', async (req, res) => {
  console.log('get branches');
  try {
    const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/branches`;
    const response = await axios.get(url, { headers: githubHeaders });
    res.json(response.data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
});

// GET /folder-structure - Returns directory structure for a folder (requires branch in query)
app.get('/folder-structure', async (req, res) => {
  console.log('get folder-structure');

  const branch = req.query.branch;
  if (!branch) {
    return res.status(400).json({ error: 'Missing required query parameter: branch' });
  }

  try {
    // 1. Get the latest commit SHA for the branch
    console.log(`[folder-structure] Fetching branch details for: ${branch}`);
    const branchUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/branches/${branch}`;
    const branchResponse = await axios.get(branchUrl, { headers: githubHeaders });
    const latestCommitSha = branchResponse.data.commit.sha;
    console.log(`[folder-structure] Latest commit SHA: ${latestCommitSha}`);

    // 2. Get the tree using the specific commit SHA
    // Note: We could get the tree SHA from the commit details first, but getting tree by commit SHA works too.
    console.log(`[folder-structure] Fetching tree for commit SHA: ${latestCommitSha}`);
    const treeUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${latestCommitSha}?recursive=1`;
    const response = await axios.get(treeUrl, { headers: githubHeaders });
    const tree = response.data.tree;
    
    // 3. Filter results (or just return the whole tree if path is root)
    // Changed default path to empty string for root
    const folderPath = req.query.path || ''; 

    let filteredTree;
    if (folderPath === '') {
      // If requesting root, return the whole tree
      filteredTree = tree;
      console.log(`[folder-structure] Found ${tree.length} total items, returning all for root.`);
    } else {
      // If requesting a subfolder, filter by path prefix
      filteredTree = tree.filter(
        item => item.path.startsWith(`${folderPath}/`) || item.path === folderPath // Keep items starting with the path or the path itself
      );
      console.log(`[folder-structure] Found ${tree.length} total items, returning ${filteredTree.length} items under '${folderPath}'`);
    }
    
    res.json(filteredTree);
  } catch (error) {
    console.error("[folder-structure] Error fetching folder structure:", error.response?.data || error.message);
    // Distinguish between branch not found vs other errors
    if (error.response?.status === 404) {
         res.status(404).json({ error: `Branch '${branch}' or its commit/tree not found.` });
    } else {
        res.status(500).json({ error: 'Failed to fetch directory structure from GitHub.' });
    }
  }
});

// GET /file-contents - Returns contents of selected file
app.get('/file-contents', async (req, res) => {
  console.log('get file-contents');
  try {
    // Validate that a branch is provided
    if (!req.query.branch) {
      return res.status(400).json({ error: 'Branch is required' });
    }
    // Validate that a file path is provided as well
    if (!req.query.path) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    const branch = req.query.branch;
    const filePath = req.query.path;

    // Construct the GitHub API URL for file contents
    // GitHub's API endpoint to fetch file contents is:
    // GET /repos/{owner}/{repo}/contents/{path}?ref={branch}
    const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${branch}`;
    console.log('Fetching file from GitHub:', url);
    
    const response = await axios.get(url, { headers: githubHeaders });
    // console.log('GitHub API response for file contents:', response.data);

    // GitHub returns the file content as a base64-encoded string.
    // Remove any newline characters that GitHub may include.
    const contentBase64 = response.data.content.replace(/\n/g, '');
    const buffer = Buffer.from(contentBase64, 'base64');
    const fileContent = buffer.toString('utf8');

    res.json({ content: fileContent });
  } catch (error) {
    console.error('Error retrieving file contents:', error);
    res.status(500).json({ error: 'Error retrieving file contents' });
  }
});

// GET /users - Get all active users
app.get('/users', async (req, res) => {
  console.log('get users');
  try {
    // SQL query to select all users where active is true
    const queryText = 'SELECT username FROM users WHERE active = true';
    const result = await pgClient.query(queryText);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

// GET /users - Get all active users
app.get('/users-all', async (req, res) => {
  console.log('get all users');
  try {
    // SQL query to select all users where active is true
    const queryText = 'SELECT username, branch_permissions, active FROM users';
    const result = await pgClient.query(queryText);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

// GET /commits - Returns recent commits/tags for a branch (IMPLEMENTED)
app.get('/commits', async (req, res) => {
  const branch = req.query.branch;
  console.log(`[commits] Fetching commits for branch: ${branch}`);

  if (!branch) {
    return res.status(400).json({ error: 'Missing required query parameter: branch' });
  }

  const authHeaders = GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {};
  const commitsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits?sha=${encodeURIComponent(branch)}&per_page=10`;
  const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;

  try {
    // 1. Fetch last 10 commits
    console.log(`[commits] Fetching from: ${commitsUrl}`);
    const commitsResponse = await axios.get(commitsUrl, { headers: authHeaders });
    const commits = commitsResponse.data; // Array of commit objects

    // 2. Fetch all tags
    console.log(`[commits] Fetching tags from: ${tagsUrl}`);
    const tagsResponse = await axios.get(tagsUrl, { headers: authHeaders });
    const tags = tagsResponse.data; // Array of tag objects { name, commit: { sha, url }, ... }

    // 3. Create a map of commit SHA -> tag name (preferring valid semver tags)
    const commitShaToTagMap = {};
    for (const tag of tags) {
        // Prioritize existing entry if it's already a valid semver tag
        const existingTag = commitShaToTagMap[tag.commit.sha];
        const isNewTagSemver = semver.valid(tag.name);
        const isExistingTagSemver = existingTag && semver.valid(existingTag);

        // If new tag is semver and existing isn't, or if new tag is simply newer (semver compare), overwrite.
        // Or if no existing tag, just add it.
         if (!existingTag || (isNewTagSemver && !isExistingTagSemver) || (isNewTagSemver && isExistingTagSemver && semver.gt(tag.name, existingTag))) {
             commitShaToTagMap[tag.commit.sha] = tag.name;
         } else if (!existingTag && !isNewTagSemver) {
             // If no tag exists yet and the new one isn't semver, add it as a fallback
             commitShaToTagMap[tag.commit.sha] = tag.name;
         }
    }
    console.log(`[commits] Built tag map for ${Object.keys(commitShaToTagMap).length} commits.`);

    // 4. Process commits into the desired format
    const processedCommits = commits.map(commit => {
      const sha = commit.sha;
      const commitData = commit.commit;
      const commitDate = new Date(commitData.committer?.date || commitData.author?.date);
      const commitMessage = commitData.message;

      // Extract author from message "[author: username]"
      const authorMatch = commitMessage.match(/\[author:\s*([^\\\]]+)\]/);
      const extractedAuthor = authorMatch ? authorMatch[1].trim() : (commit.author?.login || 'N/A'); // Fallback to commit author login

      return {
        id: sha, // Use commit SHA as the unique ID for DataGrid
        version: commitShaToTagMap[sha] || 'N/A', // Get tag from map or 'N/A'
        date: commitDate.toLocaleDateString(), // Format date
        time: commitDate.toLocaleTimeString(), // Format time
        author: extractedAuthor,
        message: commitMessage, // Keep full message
      };
    });
    
    console.log(`[commits] Processed ${processedCommits.length} commits.`);
    res.json(processedCommits);

  } catch (error) {
    console.error(`[commits] Error fetching commits/tags for branch '${branch}':`, error.response?.data || error.message);
    // Provide more specific error messages if possible
    if (error.response?.status === 404) {
        res.status(404).json({ error: `Branch '${branch}' not found or repository inaccessible.` });
    } else if (error.response?.status === 409) {
         res.status(409).json({ error: `Repository is empty or branch '${branch}' has no commits.` });
    } else {
        res.status(500).json({ error: 'Failed to fetch commit history from GitHub.' });
    }
  }
});

// ----------------------------------------
// API endpoints
// POSTs
// ----------------------------------------

// POST /commit-file - Updated for version tagging
app.post('/commit-file', async (req, res) => {
  const { username, password, path, message, content, branch, versionBumpType } = req.body;

  // Validate required fields (add versionBumpType)
  if (!username || !password || !path || !message || !content || !branch || !['major', 'minor', 'patch'].includes(versionBumpType)) {
    return res.status(400).json({
      error: 'Missing required fields or invalid versionBumpType (must be major, minor, or patch)',
    });
  }

  // Validate user credentials and branch access
  const validationResult = await validateUser(username, password, branch);
  if (!validationResult.valid) {
    return res.status(403).json({ error: validationResult.reason });
  }

  const auth = {
    username: process.env.GITHUB_USERNAME,
    password: process.env.GITHUB_TOKEN,
  };

  const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
  let commitSha = null; // To store the SHA of the new commit
  let commitSuccess = false;

  try {
    // 1. Commit the file changes
    let currentSha = null;
    try {
      const getResp = await axios.get(`${url}?ref=${branch}`, { auth });
      currentSha = getResp.data.sha;
    } catch (err) {
      if (err.response?.status !== 404) throw err;
    }

    const payload = {
      message,
      content,
      branch,
      ...(currentSha ? { sha: currentSha } : {}),
    };

    const commitResponse = await axios.put(url, payload, { auth });
    commitSha = commitResponse.data.commit.sha; // Get the SHA of the commit we just made
    commitSuccess = true;
    console.log(`[commit-file] File commit successful. SHA: ${commitSha}`);

    // 2. Handle Tagging (only if commit succeeded)
    let newTagName = null;
    let tagResult = { success: false, error: 'Tagging skipped or failed.' };

    try {
      // Fetch existing tags
      const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
      console.log('[commit-file] Fetching existing tags...');
      const tagsResponse = await axios.get(tagsUrl, { headers: githubHeaders });
      const latestTag = getLatestSemanticTag(tagsResponse.data); // Pass array of tag objects {name: '...', ...}
      console.log(`[commit-file] Latest tag found: ${latestTag || 'None'}`);
      
      // Calculate next version
      newTagName = incrementVersion(latestTag || '0.0.0', versionBumpType);
      console.log(`[commit-file] Calculated next tag: ${newTagName}`);

      // Create the new tag reference pointing to the commit we just made
      if (newTagName && commitSha) {
        tagResult = await createTagReference(newTagName, commitSha, auth);
      } else {
        tagResult.error = 'Could not calculate new tag name or missing commit SHA.';
      }
    } catch (tagLookupError) {
      console.error('[commit-file] Error during tag lookup/calculation:', tagLookupError.message);
      tagResult.error = 'Error processing existing tags.';
      // Proceed without tagging, but maybe warn the user?
    }

    // Respond based on commit and tag results
    if (tagResult.success) {
        res.json({ success: true, message: `File committed successfully and tagged as ${newTagName}.`, commit: commitResponse.data.commit, tag: newTagName });
    } else {
        // Commit succeeded, but tagging failed
        res.status(207).json({ 
            success: true, // Commit was successful
            message: `File committed successfully, but failed to create tag ${newTagName || ''}. Reason: ${tagResult.error}`, 
            commit: commitResponse.data.commit,
            tagError: tagResult.error,
        }); 
    }

  } catch (error) {
    console.error('[commit-file] Error during file commit:', error?.response?.data || error.message);
    res.status(500).json({ error: 'Failed to commit file' });
  }
});

// POST /copy-files - copy files from one branch to another
// requires user/pass/source/target/path(s)
app.post('/copy-files', async (req, res) => {
  const { username, password, source_branch, target_branch, paths } = req.body;

  if (!username || !password || !source_branch || !target_branch || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({
      error: 'Missing or invalid fields: username, password, source_branch, target_branch, paths (must be non-empty array)',
    });
  }

  const validationResult = await validateUser(username, password, target_branch);
  if (!validationResult.valid) {
    return res.status(403).json({ error: validationResult.reason });
  }

  const auth = {
    username: process.env.GITHUB_USERNAME,
    password: process.env.GITHUB_TOKEN,
  };
  const headers = { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }; // <<< Add headers for tag fetching

  const copyResults = [];
  let lastSuccessfulCommitSha = null; // <<< Initialize SHA tracker
  let overallSuccess = true; // Track if all copies succeeded without error status

  try {
    for (const filePath of paths) {
      const getUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${source_branch}`;
      let content, encoding;

      try {
        const getResp = await axios.get(getUrl, { auth });
        content = getResp.data.content;
        encoding = getResp.data.encoding;

        if (encoding !== 'base64') {
          copyResults.push({ path: filePath, status: 'skipped', reason: `Unsupported encoding: ${encoding}` });
          continue;
        }
      } catch (err) {
        copyResults.push({ path: filePath, status: 'skipped', reason: 'File not found in source branch' });
        continue;
      }

      // Check if the file exists in the target branch to get its SHA
      let sha = null;
      try {
        const checkResp = await axios.get(`${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${target_branch}`, { auth });
        sha = checkResp.data.sha;
      } catch (err) {
        if (err.response?.status !== 404) throw err;
      }

      // Prepare the payload to put the file in the target branch
      const putPayload = {
        message: `Copy ${filePath} from ${source_branch} to ${target_branch}`,
        content,
        branch: target_branch,
        ...(sha ? { sha } : {}),
      };

      try {
        const putUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
        const putResp = await axios.put(putUrl, putPayload, { auth });
        // Capture the commit SHA from the successful PUT
        lastSuccessfulCommitSha = putResp.data.commit.sha; // <<< Capture SHA
        copyResults.push({
          path: filePath,
          status: sha ? 'updated' : 'created',
          url: putResp.data.content.html_url,
        });
      } catch (err) {
        copyResults.push({
          path: filePath,
          status: 'error',
          reason: err?.response?.data?.message || err.message,
        });
        overallSuccess = false; // Mark overall success as false if any error occurs
      }
    }

    // --- Auto Tagging Logic (After Loop) --- 
    let tagResult = { success: false, error: 'Tagging skipped: No successful file copies.' };
    let finalMessage = 'File copy process completed.';
    let finalStatus = 200;

    if (lastSuccessfulCommitSha) {
        console.log(`[copy-files] Attempting to tag last successful commit: ${lastSuccessfulCommitSha}`);
        let newTagName = null;
        try {
            const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
            const tagsResponse = await axios.get(tagsUrl, { headers }); // Use headers
            const latestTag = getLatestSemanticTag(tagsResponse.data);
            newTagName = incrementVersion(latestTag || '0.0.0', 'patch');
            if (newTagName) {
                tagResult = await createTagReference(newTagName, lastSuccessfulCommitSha, auth);
            } else {
                tagResult.error = 'Could not calculate new tag name.';
            }
        } catch (tagLookupError) {
            console.error('[copy-files] Error during tag lookup/creation:', tagLookupError.message);
            tagResult.error = 'Error processing existing tags or creating new tag.';
        }

        // Adjust final message and status based on tagging outcome
        if (tagResult.success) {
             finalMessage = `Files copied successfully. New state tagged as ${newTagName}.`;
             finalStatus = 200;
        } else {
             finalMessage = `Files copied (with potential errors/skips), but failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`;
             finalStatus = 207; // Partial success
        }
    } else {
        // No successful commits to tag
        finalMessage = 'File copy process completed, but no files were successfully copied/updated.';
        finalStatus = overallSuccess ? 200 : 400; // Use 400 if errors occurred, 200 if only skips
    }
    // --- End Auto Tagging Logic ---

    // Respond with combined results and tagging info
    res.status(finalStatus).json({ 
        success: overallSuccess && tagResult.success, // Overall success depends on copy AND tag
        message: finalMessage,
        results: copyResults,
        ...(tagResult.error && !tagResult.success && { tagError: tagResult.error }) // Include tagError only on failure
    });

  } catch (error) {
    console.error('[copy-files] Unexpected error:', error?.response?.data || error.message);
    res.status(500).json({ error: 'Unexpected server error' });
  }
});

// POST /create-branch - Creates a new branch and applies a patch version bump tag
app.post('/create-branch', async (req, res) => {
  const { username, password, newBranchName, sourceBranch } = req.body; // Removed unused 'message'

  // --- Validation --- 
  if (!username || !password || !newBranchName || !sourceBranch) {
    return res.status(400).json({
      error: 'Missing required fields: username, password, newBranchName, sourceBranch',
    });
  }

  // Validate user credentials (adapt validation logic as needed)
  // Option 1: Basic user validation only
  // const validationResult = await validateUser(username, password); // Assuming validateUser checks only user/pass
  // Option 2: Validate against source branch permission (similar to /copy-files target branch validation)
  const validationResult = await validateUser(username, password, sourceBranch); 
  if (!validationResult.valid) {
    return res.status(403).json({ error: validationResult.reason });
  }

  const auth = {
      username: process.env.GITHUB_USERNAME,
      password: process.env.GITHUB_TOKEN, 
  };
  const headers = { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' };

  try {
    // 1. Get the SHA of the source branch
    console.log(`[create-branch] Fetching SHA for source branch: ${sourceBranch}`);
    const sourceBranchUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/branches/${sourceBranch}`;
    const branchResponse = await axios.get(sourceBranchUrl, { headers });
    const sourceSha = branchResponse.data.commit.sha;
    console.log(`[create-branch] Source SHA: ${sourceSha}`);

    // 2. Create the new branch reference
    console.log(`[create-branch] Creating new branch ref: refs/heads/${newBranchName}`);
    const createRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`;
    const refPayload = {
      ref: `refs/heads/${newBranchName}`,
      sha: sourceSha,
    };
    const createResponse = await axios.post(createRefUrl, refPayload, { headers });
    // The SHA for the tag should be the same as the source branch SHA it points to
    const newBranchShaForTag = sourceSha; 
    console.log(`[create-branch] Branch '${newBranchName}' created successfully pointing to SHA: ${newBranchShaForTag}`);
    
    // 3. Calculate and Create the new tag (Patch Bump)
    let newTagName = null;
    let tagResult = { success: false, error: 'Tagging skipped or failed.' };
    try {
        const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
        console.log('[create-branch] Fetching existing tags for auto-bump...');
        const tagsResponse = await axios.get(tagsUrl, { headers });
        const latestTag = getLatestSemanticTag(tagsResponse.data);
        console.log(`[create-branch] Latest tag found: ${latestTag || 'None'}`);
        newTagName = incrementVersion(latestTag || '0.0.0', 'patch'); // Force patch bump
        console.log(`[create-branch] Calculated next tag (patch): ${newTagName}`);

        if (newTagName && newBranchShaForTag) {
            tagResult = await createTagReference(newTagName, newBranchShaForTag, auth); // Tag the commit the new branch points to
        } else {
            tagResult.error = 'Could not calculate new tag name or missing branch SHA.';
        }
    } catch (tagLookupError) {
        console.error('[create-branch] Error during tag lookup/calculation:', tagLookupError.message);
        tagResult.error = 'Error processing existing tags.';
    }

    // Adjust response based on tag result
    if (tagResult.success) {
      res.status(201).json({ success: true, message: `Branch '${newBranchName}' created and tagged as ${newTagName}.`, data: createResponse.data });
    } else {
      res.status(207).json({ 
          success: true, // Branch creation succeeded
          message: `Branch '${newBranchName}' created, but failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`,
          data: createResponse.data,
          tagError: tagResult.error,
      });
    }

  } catch (error) {
      console.error(`[create-branch] Error creating branch '${newBranchName}' from '${sourceBranch}':`, error.response?.data || error.message);
      if (error.response?.status === 422) {
           // Branch likely already exists
          res.status(422).json({ error: `Failed to create branch. Branch '${newBranchName}' may already exist.` });
      } else if (error.response?.status === 404) {
          res.status(404).json({ error: `Source branch '${sourceBranch}' not found.` });
      } else {
          res.status(500).json({ error: 'Failed to create branch on GitHub.' });
      }
  }
});

// POST /retire-branch - Renames a branch by adding -retired suffix
app.post('/retire-branch', async (req, res) => {
  const { username, password, branchToRetire } = req.body;

  // --- Validation --- 
  if (!username || !password || !branchToRetire) {
    return res.status(400).json({
      error: 'Missing required fields: username, password, branchToRetire',
    });
  }

  // Prevent retiring the main branch or already retired branches
  if (branchToRetire === 'main') {
    return res.status(400).json({ error: 'Cannot retire the main branch.' });
  }
  if (branchToRetire.endsWith('-retired')) {
      return res.status(400).json({ error: `Branch '${branchToRetire}' is already retired.` });
  }

  // Validate user credentials (Using basic user/pass validation here, adjust if needed)
  const validationResult = await validateUser(username, password);
  if (!validationResult.valid) {
    return res.status(403).json({ error: validationResult.reason });
  }
  // Enforce admin-only retirement
  if (username !== 'admin') { 
    return res.status(403).json({ error: 'Only admin can retire branches.'});
  }

  // --- GitHub API Interaction --- 
  const auth = {
    username: process.env.GITHUB_USERNAME,
    password: process.env.GITHUB_TOKEN, // Use PAT for auth
  };
  const retiredBranchName = `${branchToRetire}-retired`;

  try {
    // 1. Get the SHA of the branch to retire
    const branchInfoUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branchToRetire}`;
    let sourceSha;
    try {
      console.log(`[retire-branch] Fetching SHA for branch: ${branchToRetire}`);
      const branchResponse = await axios.get(branchInfoUrl, { auth });
      sourceSha = branchResponse.data.object.sha; // Use object.sha for refs
      console.log(`[retire-branch] Found SHA: ${sourceSha}`);
    } catch (error) {
      console.error(`[retire-branch] Error fetching SHA for ${branchToRetire}:`, error.response?.data || error.message);
      // Handle case where branch might not exist (e.g., race condition)
      if (error.response?.status === 404) {
          return res.status(404).json({ error: `Branch '${branchToRetire}' not found.` });
      }
      return res.status(500).json({ error: `Error accessing branch '${branchToRetire}'.` });
    }

    // 2. Create the new retired branch reference
    const createRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`;
    const createPayload = {
      ref: `refs/heads/${retiredBranchName}`,
      sha: sourceSha,
    };
    console.log(`[retire-branch] Attempting to create retired ref: ${createPayload.ref}`);
    await axios.post(createRefUrl, createPayload, { auth });
    console.log(`[retire-branch] Created retired ref: ${retiredBranchName}`);

    // 3. Delete the original branch reference
    const deleteRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branchToRetire}`;
    console.log(`[retire-branch] Attempting to delete original ref: refs/heads/${branchToRetire}`);
    await axios.delete(deleteRefUrl, { auth });
    console.log(`[retire-branch] Deleted original ref: ${branchToRetire}`);

    res.status(200).json({ success: true, message: `Branch '${branchToRetire}' retired successfully as '${retiredBranchName}'.` });

  } catch (error) {
    // Handle potential errors during create/delete (e.g., retired branch already exists)
    console.error(`[retire-branch] Error retiring branch '${branchToRetire}':`, error.response?.data || error.message);
    // Attempt to clean up if retired branch was created but original delete failed?
    // This part can be complex. For now, just return a generic error.
    res.status(500).json({ error: `Failed to retire branch '${branchToRetire}'. Please check GitHub manually.` });
  }
});

// POST /revert-branch - Creates a new commit reflecting the state of an old commit, with auto patch bump
app.post('/revert-branch', async (req, res) => {
    const { username, password, branchToRevert, commitShaToRevertTo, message } = req.body;
    const commitMessage = message || `Revert branch '${branchToRevert}' to state of commit ${commitShaToRevertTo.substring(0, 7)}`;

    // --- Validation ---
    if (!username || !password || !branchToRevert || !commitShaToRevertTo) {
        return res.status(400).json({ error: 'Missing required fields: username, password, branchToRevert, commitShaToRevertTo' });
    }
    if (branchToRevert === 'main') {
         return res.status(400).json({ error: 'Cannot revert the main branch via this method.' });
    }

    // Validate user credentials and branch access
    const validationResult = await validateUser(username, password, branchToRevert);
    if (!validationResult.valid) {
        return res.status(403).json({ error: validationResult.reason });
    }

    // --- GitHub API Interaction ---
    const auth = {
        username: process.env.GITHUB_USERNAME,
        password: process.env.GITHUB_TOKEN, // Use PAT for auth
    };
    const headers = { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' };

    try {
        // 1. Get Source Commit Data (to find its tree SHA)
        console.log(`[revert-branch] Fetching source commit: ${commitShaToRevertTo}`);
        const sourceCommitUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${commitShaToRevertTo}`;
        const sourceCommitResponse = await axios.get(sourceCommitUrl, { headers });
        const sourceTreeSha = sourceCommitResponse.data.tree.sha;
        console.log(`[revert-branch] Source tree SHA: ${sourceTreeSha}`);

        // 4. Create a New Commit Object
        //    - Get the current HEAD of the target branch to use as parent
        console.log(`[revert-branch] Fetching current HEAD for branch: ${branchToRevert}`);
        const branchRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branchToRevert}`;
        const branchRefResponse = await axios.get(branchRefUrl, { headers });
        const currentHeadSha = branchRefResponse.data.object.sha;
        console.log(`[revert-branch] Current HEAD SHA: ${currentHeadSha}`);

        //    - Create the commit
        console.log(`[revert-branch] Creating new commit object...`);
        const createCommitUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`;
        const newCommitPayload = {
            message: `${commitMessage} [author: ${username}]`, // Append author info
            tree: sourceTreeSha,      // Point to the source commit's existing tree
            parents: [currentHeadSha] // Set parent to the current HEAD
        };
        const createCommitResponse = await axios.post(createCommitUrl, newCommitPayload, { headers });
        const newCommitSha = createCommitResponse.data.sha;
        console.log(`[revert-branch] New commit created SHA: ${newCommitSha}`);

        // --- Auto Tagging (Patch Bump) ---
        let newTagName = null;
        let tagResult = { success: false, error: 'Tagging skipped or failed.' };
        try {
            const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
            console.log('[revert-branch] Fetching existing tags for auto-bump...');
            const tagsResponse = await axios.get(tagsUrl, { headers });
            const latestTag = getLatestSemanticTag(tagsResponse.data);
            console.log(`[revert-branch] Latest tag found: ${latestTag || 'None'}`);
            newTagName = incrementVersion(latestTag || '0.0.0', 'patch'); // Force patch bump
            console.log(`[revert-branch] Calculated next tag (patch): ${newTagName}`);

            if (newTagName && newCommitSha) {
                tagResult = await createTagReference(newTagName, newCommitSha, auth); // Tag the NEW commit
            } else {
                tagResult.error = 'Could not calculate new tag name.';
            }
        } catch (tagLookupError) {
            console.error('[revert-branch] Error during tag lookup/calculation:', tagLookupError.message);
            tagResult.error = 'Error processing existing tags.';
        }
        // --- End Auto Tagging ---

        // 5. Update the Branch Reference (fast-forward)
        console.log(`[revert-branch] Updating branch reference ${branchToRevert} to point to ${newCommitSha}`);
        const updateRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branchToRevert}`;
        const updateRefPayload = {
            sha: newCommitSha,
            force: false // Should be a fast-forward, so force: false is appropriate
        };
        await axios.patch(updateRefUrl, updateRefPayload, { headers });

        // Adjust final message based on tagging success
        let finalMessage = `Branch '${branchToRevert}' reverted to state of commit ${commitShaToRevertTo.substring(0, 7)}.`;
        if (tagResult.success) {
            finalMessage += ` New state tagged as ${newTagName}.`;
            res.status(200).json({ success: true, message: finalMessage });
        } else {
            finalMessage += ` Failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`;
             // Send 207 since branch update succeeded but tag failed
            res.status(207).json({ success: true, message: finalMessage, tagError: tagResult.error });
        }
        console.log(`[revert-branch] Update complete. Final status: ${tagResult.success ? 'Tagged' : 'Tag failed'}`);

    } catch (error) {
        console.error(`[revert-branch] Error during revert process for branch '${branchToRevert}':`, error.response?.data || error.message);
        // Add specific error checks if needed (e.g., 404 for bad SHAs/branch, 422 for bad parents)
        res.status(500).json({ error: `Failed to revert branch '${branchToRevert}'. Check server logs.` });
    }
});

// POST /add-file - Creates a new blank file in a specified branch and path
app.post('/add-file', async (req, res) => {
    const { username, password, branch, path, filename } = req.body;
    const fullPath = path ? `${path}/${filename}` : filename; // Construct full path

    // --- Validation ---
    if (!username || !password || !branch || !filename) {
        return res.status(400).json({ error: 'Missing required fields: username, password, branch, filename (path is optional)' });
    }
     // Basic filename validation (prevent slashes, etc.) - enhance as needed
     if (filename.includes('/') || filename.includes('\\')) {
         return res.status(400).json({ error: 'Invalid filename: cannot contain slashes.' });
     }

    // Validate user credentials and branch access
    const validationResult = await validateUser(username, password, branch);
    if (!validationResult.valid) {
        return res.status(403).json({ error: validationResult.reason });
    }

    // --- GitHub API Interaction ---
    const auth = {
        username: process.env.GITHUB_USERNAME,
        password: process.env.GITHUB_TOKEN, // Use PAT for auth
    };
    const headers = { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' };
    const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${fullPath}`;

    try {
        // 1. Commit the new blank file
        console.log(`[add-file] Attempting to create file: ${fullPath} on branch ${branch}`);
        const contentBase64 = Buffer.from('').toString('base64'); // Content is an empty string
        const commitMessage = `Add new file: ${fullPath} [author: ${username}]`;
        const payload = {
            message: commitMessage,
            content: contentBase64,
            branch: branch,
            // Do NOT include SHA when creating a new file
        };

        // Check if file already exists before attempting PUT
        try {
          await axios.get(`${url}?ref=${branch}`, { headers });
          // If the GET succeeds, the file exists
          return res.status(409).json({ error: `File already exists at path: ${fullPath} on branch ${branch}` });
        } catch (getError) {
           // Expecting 404 if file doesn't exist, proceed if so
           if (getError.response?.status !== 404) {
               console.error(`[add-file] Error checking for existing file ${fullPath}:`, getError.response?.data || getError.message);
               throw new Error('Failed to check if file exists before creation.'); // Rethrow unexpected errors
           }
            // File not found (404), good to proceed with creation
           console.log(`[add-file] File ${fullPath} does not exist on branch ${branch}. Proceeding with creation.`);
        }

        const commitResponse = await axios.put(url, payload, { auth }); // Use auth object here
        const commitSha = commitResponse.data.commit.sha;
        console.log(`[add-file] File '${fullPath}' created successfully. Commit SHA: ${commitSha}`);

        // 2. Handle Tagging (Patch Bump)
        let newTagName = null;
        let tagResult = { success: false, error: 'Tagging skipped or failed.' };
        try {
            const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
            console.log('[add-file] Fetching existing tags for auto-bump...');
            const tagsResponse = await axios.get(tagsUrl, { headers }); // Use headers with token here
            const latestTag = getLatestSemanticTag(tagsResponse.data);
            console.log(`[add-file] Latest tag found: ${latestTag || 'None'}`);
            
            newTagName = incrementVersion(latestTag || '0.0.0', 'patch'); // Force patch bump
            console.log(`[add-file] Calculated next tag (patch): ${newTagName}`);

            if (newTagName && commitSha) {
                // Use auth object for createTagReference
                tagResult = await createTagReference(newTagName, commitSha, auth); 
            } else {
                tagResult.error = 'Could not calculate new tag name or missing commit SHA.';
            }
        } catch (tagLookupError) {
            console.error('[add-file] Error during tag lookup/calculation:', tagLookupError.message);
            tagResult.error = 'Error processing existing tags.';
        }

        // Respond based on commit and tag results
        if (tagResult.success) {
            res.status(201).json({ 
                success: true, 
                message: `File '${fullPath}' created successfully and tagged as ${newTagName}.`, 
                commit: commitResponse.data.commit, 
                tag: newTagName 
            });
        } else {
            // Commit succeeded, but tagging failed
            res.status(207).json({ 
                success: true, // Commit was successful
                message: `File '${fullPath}' created successfully, but failed to create tag ${newTagName || ''}. Reason: ${tagResult.error}`, 
                commit: commitResponse.data.commit,
                tagError: tagResult.error,
            }); 
        }

    } catch (error) {
        console.error(`[add-file] Error creating file '${fullPath}' on branch '${branch}':`, error.response?.data || error.message);
         // Check if it was the PUT call that failed specifically due to conflict (though pre-check should prevent this)
        if (error.response?.status === 422 && error.response?.data?.message?.includes('sha')) {
             res.status(409).json({ error: `Conflict: File '${fullPath}' might have been created concurrently or already exists.` });
        } else {
             res.status(500).json({ error: `Failed to create file '${fullPath}' on GitHub.` });
        }
    }
});

// POST /add-folder - Creates a new folder by adding a .gitkeep file
app.post('/add-folder', async (req, res) => {
    const { username, password, branch, path, foldername } = req.body;

    // --- Validation ---
    if (!username || !password || !branch || !foldername || !path) { // Ensure path is also provided
        return res.status(400).json({ error: 'Missing required fields: username, password, branch, path, foldername' });
    }
    // Basic foldername validation (prevent slashes, etc.) - enhance as needed
    if (foldername.includes('/') || foldername.includes('\\')) {
        return res.status(400).json({ error: 'Invalid foldername: cannot contain slashes.' });
    }

    // Validate user credentials and branch access (user needs access to the branch they are modifying)
    const validationResult = await validateUser(username, password, branch);
    if (!validationResult.valid) {
        return res.status(403).json({ error: validationResult.reason });
    }

    // --- GitHub API Interaction ---
    const auth = {
        username: process.env.GITHUB_USERNAME,
        password: process.env.GITHUB_TOKEN, // Use PAT for auth
    };
    const headers = { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' };
    
    // Path to the .gitkeep file within the new folder
    const gitkeepPath = `${path}/${foldername}/.gitkeep`; 
    const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${gitkeepPath}`;

    try {
        // 1. Attempt to create the .gitkeep file
        console.log(`[add-folder] Attempting to create folder placeholder: ${gitkeepPath} on branch ${branch}`);
        const contentBase64 = Buffer.from('# Empty directory placeholder').toString('base64'); // Optional content
        const commitMessage = `Create folder: ${path}/${foldername} [author: ${username}]`;
        const payload = {
            message: commitMessage,
            content: contentBase64,
            branch: branch,
        };

        // Check if the .gitkeep file (or folder path) already exists
        try {
            await axios.get(`${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}/${foldername}?ref=${branch}`, { headers });
            // If the GET succeeds, the folder path likely exists (or at least the .gitkeep file does)
            return res.status(409).json({ error: `Folder already exists at path: ${path}/${foldername} on branch ${branch}` });
        } catch (getError) {
            // Expecting 404 if folder/file doesn't exist, proceed if so
            if (getError.response?.status !== 404) {
                console.error(`[add-folder] Error checking for existing folder ${path}/${foldername}:`, getError.response?.data || getError.message);
                throw new Error('Failed to check if folder exists before creation.'); // Rethrow unexpected errors
            }
            // Path not found (404), good to proceed with creation
            console.log(`[add-folder] Path ${path}/${foldername} does not exist on branch ${branch}. Proceeding with folder creation.`);
        }

        // Use PUT to create the file
        const commitResponse = await axios.put(url, payload, { auth });
        console.log(`[add-folder] Folder placeholder '${gitkeepPath}' created successfully. Commit SHA: ${commitResponse.data.commit.sha}`);

        // Respond with success - No tagging for folder creation
        res.status(201).json({ 
            success: true, 
            message: `Folder '${foldername}' created successfully in '${path}'.`, 
            commit: commitResponse.data.commit 
        });

    } catch (error) {
        console.error(`[add-folder] Error creating folder '${path}/${foldername}' on branch '${branch}':`, error.response?.data || error.message);
        // Check for specific GitHub errors if needed
        if (error.response?.status === 409 || (error.response?.status === 422 && error.response?.data?.message?.includes('sha'))) {
            // 422 with SHA message usually indicates the file already exists (race condition maybe)
            res.status(409).json({ error: `Conflict: Folder '${path}/${foldername}' might already exist or have been created concurrently.` });
        } else {
            res.status(500).json({ error: `Failed to create folder '${foldername}' on GitHub.` });
        }
    }
});

// POST /copy-item-intra-branch - Copies a file or folder within the same branch
app.post('/copy-item-intra-branch', async (req, res) => {
    const { username, password, branch, sourcePath, destinationPath, newName } = req.body;
    const fullNewPath = `${destinationPath}/${newName}`;

    // --- Validation ---
    if (!username || !password || !branch || !sourcePath || !destinationPath || !newName) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }
    if (newName.includes('/') || newName.includes('\\') || destinationPath.includes('..') || sourcePath.includes('..')) {
        return res.status(400).json({ error: 'Invalid characters or navigation in names/paths.' });
    }
    if (sourcePath === fullNewPath || fullNewPath.startsWith(`${sourcePath}/`)) {
         return res.status(400).json({ error: 'Cannot copy an item into itself.' });
    }

    // Validate user credentials and branch access
    const validationResult = await validateUser(username, password, branch);
    if (!validationResult.valid) {
        return res.status(403).json({ error: validationResult.reason });
    }

    // --- GitHub API Setup ---
    const auth = {
        username: process.env.GITHUB_USERNAME,
        password: process.env.GITHUB_TOKEN,
    };
    const headers = { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' };
    const commitMessage = `Copy ${sourcePath} to ${fullNewPath} [author: ${username}]`;

    try {
        // 1. Determine if source is file or folder & get its SHA (for file content fetch)
        console.log(`[copy-intra] Checking source item type: ${sourcePath}`);
        const sourceContentsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${sourcePath}?ref=${branch}`;
        let sourceItemData;
        try {
            const sourceResponse = await axios.get(sourceContentsUrl, { headers });
            sourceItemData = sourceResponse.data;
        } catch (error) {
            if (error.response?.status === 404) {
                return res.status(404).json({ error: `Source path '${sourcePath}' not found.` });
            }
            console.error(`[copy-intra] Error fetching source item data:`, error.response?.data || error.message);
            throw new Error('Failed to fetch source item details.');
        }

        // Determine the source type correctly
        let sourceType;
        if (Array.isArray(sourceItemData)) {
            sourceType = 'dir'; // GitHub API returns an array for directory contents
        } else if (sourceItemData && typeof sourceItemData === 'object' && sourceItemData.type === 'file') {
            sourceType = 'file'; // GitHub API returns an object for file contents
        } else {
             // Handle unexpected response format
             console.error(`[copy-intra] Unexpected source item data format for path ${sourcePath}:`, sourceItemData);
             // It's crucial to return an error here, otherwise the function might proceed with undefined sourceType
             return res.status(500).json({ error: `Unexpected data format received for source path '${sourcePath}'. Could not determine item type.` });
        }

        // --- Handle FILE Copy (Contents API) ---
        // Use the determined sourceType instead of sourceItemData.type directly
        if (sourceType === 'file') {
            console.log(`[copy-intra] Source is a file. Proceeding with Contents API copy.`);
            // Check if destination exists (optional, PUT will overwrite)
            // Fetch file content
            if (!sourceItemData.content) {
                 console.error("[copy-intra] File content is missing from source data.", sourceItemData);
                 throw new Error('Source file content could not be retrieved.');
            }
            const fileContentBase64 = sourceItemData.content.replace(/\n/g, '');

            // Create/update file at destination using Contents API PUT
            const destContentsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${fullNewPath}`;
            let currentDestSha = null;
            try {
                // Check if destination exists to get its SHA for update
                const destCheckResponse = await axios.get(`${destContentsUrl}?ref=${branch}`, { headers });
                currentDestSha = destCheckResponse.data.sha;
                console.log(`[copy-intra] Destination file exists, SHA: ${currentDestSha}. Will overwrite.`);
            } catch (error) {
                 if (error.response?.status !== 404) { // Ignore 404 (file doesn't exist)
                      console.error(`[copy-intra] Error checking destination path ${fullNewPath}:`, error.response?.data || error.message);
                      throw new Error('Failed to check destination path.');
                 }
                 console.log(`[copy-intra] Destination file does not exist. Will create.`);
            }

            const putPayload = {
                message: commitMessage,
                content: fileContentBase64,
                branch: branch,
                ...(currentDestSha ? { sha: currentDestSha } : {}), // Include SHA only if updating
            };

            const putResponse = await axios.put(destContentsUrl, putPayload, { auth });
            const newCommitSha = putResponse.data.commit.sha;
            console.log(`[copy-intra] File copied successfully via PUT. Commit SHA: ${newCommitSha}`);

            // --- Auto Tagging for File Copy ---
            let newTagName = null;
            let tagResult = { success: false, error: 'Tagging skipped or failed.' };
            try {
                const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
                const tagsResponse = await axios.get(tagsUrl, { headers });
                const latestTag = getLatestSemanticTag(tagsResponse.data);
                newTagName = incrementVersion(latestTag || '0.0.0', 'patch');
                if (newTagName && newCommitSha) {
                    tagResult = await createTagReference(newTagName, newCommitSha, auth);
                } else { tagResult.error = 'Could not calculate new tag name.'; }
            } catch (tagLookupError) { tagResult.error = 'Error processing existing tags.'; }
            // --- End Auto Tagging ---

             let finalMessage = `File copied to '${fullNewPath}' successfully.`;
             if (tagResult.success) { finalMessage += ` New state tagged as ${newTagName}.`; }
             else { finalMessage += ` Failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`; }
 
             res.status(tagResult.success ? 200 : 207).json({ 
                 success: true, message: finalMessage, 
                 commit: putResponse.data.commit, 
                 ...(tagResult.error && { tagError: tagResult.error })
             });
             return; // End execution for file copy
        }

        // --- Handle FOLDER Copy (Git Data API) ---
        // Use the determined sourceType instead of sourceItemData.type directly
        if (sourceType === 'dir') {
            console.log(`[copy-intra] Source is a directory. Proceeding with Git Data API copy.`);
            
            // Get latest commit and root tree SHA (needed for base tree and creating commit)
            console.log(`[copy-intra] Fetching ref for branch: ${branch}`);
            const refUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branch}`;
            const refResponse = await axios.get(refUrl, { headers });
            const latestCommitSha = refResponse.data.object.sha;
            console.log(`[copy-intra] Latest commit SHA: ${latestCommitSha}`);

            const commitUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${latestCommitSha}`;
            const commitResponse = await axios.get(commitUrl, { headers });
            const rootTreeSha = commitResponse.data.tree.sha;
            console.log(`[copy-intra] Root tree SHA: ${rootTreeSha}`);

            // Get the full recursive tree for the branch
            console.log(`[copy-intra] Fetching recursive tree for SHA: ${rootTreeSha}`);
            const fullTreeUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${rootTreeSha}?recursive=1`;
            const fullTreeResponse = await axios.get(fullTreeUrl, { headers });
            const currentBranchTree = fullTreeResponse.data.tree;

            // Filter items within the source path and remap their paths
            const itemsToCopy = currentBranchTree.filter(item => 
                 item.path === sourcePath || // Include the source dir itself if needed? No, Git Data API works on contents.
                 item.path.startsWith(`${sourcePath}/`)
            );
            
            if (itemsToCopy.length === 0) {
                 console.warn(`[copy-intra] No items found within source directory path: ${sourcePath}`);
                 // Treat as success? Or error? Let's call it success with a note.
                 // Copying an empty folder essentially.
                 // We could create the destination folder with a .gitkeep? Let's skip for now.
                 // Let's use the PUT approach to create the destination with .gitkeep
                console.log("[copy-intra] Source folder is empty or not found recursively. Creating empty destination folder.");
                 const gitkeepPath = `${fullNewPath}/.gitkeep`;
                 const destContentsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${gitkeepPath}`;
                 const putPayload = {
                      message: commitMessage + " (empty folder)",
                      content: Buffer.from('# Empty directory placeholder').toString('base64'),
                      branch: branch,
                 };
                 try {
                      const putResponse = await axios.put(destContentsUrl, putPayload, { auth });
                      // Tagging for empty folder creation
                      const newCommitSha = putResponse.data.commit.sha;
                      let newTagName = null;
                      let tagResult = { success: false, error: 'Tagging skipped or failed.' };
                      try {
                          const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
                          const tagsResponse = await axios.get(tagsUrl, { headers });
                          const latestTag = getLatestSemanticTag(tagsResponse.data);
                          newTagName = incrementVersion(latestTag || '0.0.0', 'patch');
                          if (newTagName && newCommitSha) {
                              tagResult = await createTagReference(newTagName, newCommitSha, auth);
                          } else { tagResult.error = 'Could not calculate new tag name.'; }
                      } catch (tagLookupError) { tagResult.error = 'Error processing existing tags.'; }
      
                      let finalMessage = `Copied empty folder to '${fullNewPath}'.`;
                      if (tagResult.success) { finalMessage += ` Tagged as ${newTagName}.`; }
                      else { finalMessage += ` Failed to tag. Reason: ${tagResult.error}`; }
      
                      res.status(tagResult.success ? 200 : 207).json({ 
                          success: true, message: finalMessage, 
                          commit: putResponse.data.commit, 
                          ...(tagResult.error && { tagError: tagResult.error })
                      });
                 } catch (putError) {
                      console.error(`[copy-intra] Error creating empty destination folder ${fullNewPath}:`, putError.response?.data || putError.message);
                      throw new Error(`Failed to create empty destination folder.`);
                 }
                 return; // Exit after handling empty folder case
            }

            const remappedItems = itemsToCopy.map(item => ({
                 path: item.path.replace(sourcePath, fullNewPath), // Adjust path
                 mode: item.mode,
                 type: item.type,
                 sha: item.sha, // Use original SHA for blobs/trees
            }));
            console.log(`[copy-intra] Remapped ${remappedItems.length} items to destination ${fullNewPath}`);

            // Create the new tree definition: start with current tree, remove potential conflicts at destination, add remapped items
            const baseTreeDefinition = currentBranchTree
                .filter(item => !item.path.startsWith(`${fullNewPath}/`) && item.path !== fullNewPath) // Remove destination conflict
                .map(item => ({ path: item.path, mode: item.mode, type: item.type, sha: item.sha })); // Map to API format
            
            const finalTreeDefinition = [...baseTreeDefinition, ...remappedItems];

            // Create the new tree object
            console.log(`[copy-intra] Creating new tree object for copy...`);
            const createTreeUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`;
            // Using base_tree might be problematic if the base already contains the destination path? Test without first.
            const createTreePayload = { tree: finalTreeDefinition }; 
            const createTreeResponse = await axios.post(createTreeUrl, createTreePayload, { headers });
            const newTreeSha = createTreeResponse.data.sha;
            console.log(`[copy-intra] New tree SHA: ${newTreeSha}`);

            if (newTreeSha === rootTreeSha) {
                 console.error("[copy-intra] Tree SHA did not change after copy operation. This indicates a potential issue.");
                 // Don't fail outright, but this is suspicious
            }

            // Create the commit
            console.log(`[copy-intra] Creating commit...`);
            const createCommitUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`;
            const createCommitPayload = {
                message: commitMessage,
                tree: newTreeSha,
                parents: [latestCommitSha],
            };
            const createCommitResponse = await axios.post(createCommitUrl, createCommitPayload, { headers });
            const newCommitSha = createCommitResponse.data.sha;
            console.log(`[copy-intra] New commit SHA: ${newCommitSha}`);

            // --- Auto Tagging for Folder Copy ---
            let newTagName = null;
            let tagResult = { success: false, error: 'Tagging skipped or failed.' };
            try {
                const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
                const tagsResponse = await axios.get(tagsUrl, { headers });
                const latestTag = getLatestSemanticTag(tagsResponse.data);
                newTagName = incrementVersion(latestTag || '0.0.0', 'patch');
                if (newTagName && newCommitSha) {
                    tagResult = await createTagReference(newTagName, newCommitSha, auth);
                } else { tagResult.error = 'Could not calculate new tag name.'; }
            } catch (tagLookupError) { tagResult.error = 'Error processing existing tags.'; }
            // --- End Auto Tagging ---

            // Update branch reference
            console.log(`[copy-intra] Updating branch reference '${branch}' to ${newCommitSha}`);
            const updateRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branch}`;
            await axios.patch(updateRefUrl, { sha: newCommitSha }, { headers });
            console.log(`[copy-intra] Branch '${branch}' updated successfully.`);

             let finalMessage = `Folder copied to '${fullNewPath}' successfully.`;
             if (tagResult.success) { finalMessage += ` New state tagged as ${newTagName}.`; }
             else { finalMessage += ` Failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`; }
 
             res.status(tagResult.success ? 200 : 207).json({ 
                 success: true, message: finalMessage, 
                 commit: createCommitResponse.data, 
                 ...(tagResult.error && { tagError: tagResult.error })
             });
            return; // End execution for folder copy
        }

        // If source type was neither 'file' nor 'dir'
        return res.status(400).json({ error: `Unsupported source item type: ${sourceItemData.type}` });

    } catch (error) {
        console.error(`[copy-intra] Error copying item from '${sourcePath}' to '${fullNewPath}':`, error.response?.data || error.message || error);
        res.status(error.response?.status || 500).json({ 
             error: `Failed to copy item. ${error.response?.data?.message || error.message || ''}` 
        });
    }
});

// DELETE /item - Deletes a file or folder (Using Git Data API - Level-by-Level)
app.delete('/item', async (req, res) => {
    const { username, password, branch, path, message } = req.body;

    // --- Validation ---
    if (!username || !password || !branch || !path || !message) {
        return res.status(400).json({ error: 'Missing required fields: username, password, branch, path, message' });
    }
    if (path === '/' || path === '' || path.startsWith('.') || path.includes('..')) {
         return res.status(400).json({ error: 'Invalid or potentially unsafe path for deletion.' });
    }

    // Validate user credentials and branch access
    const validationResult = await validateUser(username, password, branch);
    if (!validationResult.valid) {
        return res.status(403).json({ error: validationResult.reason });
    }

    // --- GitHub API Interaction (Git Data API - Level-by-Level) ---
    const auth = {
        username: process.env.GITHUB_USERNAME,
        password: process.env.GITHUB_TOKEN, // Use PAT for auth
    };
    const headers = { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' };
    
    try {
        // --- Helper function to get tree content ---
        const getTree = async (treeSha) => {
            const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${treeSha}`;
            console.log(`[getTree] Fetching tree: ${treeSha}`);
            try {
                 const response = await axios.get(url, { headers });
                 return response.data.tree; // Returns array of children {path, mode, type, sha}
            } catch (error) {
                 console.error(`[getTree] Error fetching tree ${treeSha}:`, error.response?.data || error.message);
                 throw new Error(`Failed to fetch tree data for SHA: ${treeSha}`);
            }
        };

        // --- Helper function to create a new tree ---
        const createTree = async (treeDefinition) => {
            const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`;
            console.log(`[createTree] Creating new tree...`);
            try {
                const response = await axios.post(url, { tree: treeDefinition }, { headers });
                console.log(`[createTree] New tree created SHA: ${response.data.sha}`);
                return response.data.sha;
            } catch (error) {
                console.error(`[createTree] Error creating tree:`, error.response?.data || error.message, "Definition:", treeDefinition);
                throw new Error('Failed to create new tree object on GitHub.');
            }
        };

        // 1. Get latest commit and root tree SHA
        console.log(`[delete-item] Fetching ref for branch: ${branch}`);
        const refUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branch}`;
        const refResponse = await axios.get(refUrl, { headers });
        const latestCommitSha = refResponse.data.object.sha;
        console.log(`[delete-item] Latest commit SHA: ${latestCommitSha}`);

        const commitUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${latestCommitSha}`;
        const commitResponse = await axios.get(commitUrl, { headers });
        const rootTreeSha = commitResponse.data.tree.sha;
        console.log(`[delete-item] Root tree SHA: ${rootTreeSha}`);

        // 2. Split path and prepare for traversal
        const pathSegments = path.split('/').filter(Boolean);
        const itemName = pathSegments.pop(); // Item to delete
        const parentPathSegments = pathSegments; // Path to the parent directory
        
        if (!itemName) {
             return res.status(400).json({ error: 'Invalid path provided.' });
        }

        let currentTreeSha = rootTreeSha;
        const treeShas = [rootTreeSha]; // Store SHAs as we go down

        // 3. Traverse down to the parent directory, fetching non-recursive trees
        console.log(`[delete-item] Traversing path segments: ${parentPathSegments.join('/')}`);
        for (const segment of parentPathSegments) {
            const currentTreeContent = await getTree(currentTreeSha);
            const entry = currentTreeContent.find(item => item.path === segment && item.type === 'tree');
            if (!entry) {
                console.log(`[delete-item] Path segment '${segment}' not found or not a tree in SHA: ${currentTreeSha}`);
                return res.status(404).json({ error: `Path not found: Could not find directory '${segment}'.` });
            }
            currentTreeSha = entry.sha; // Move to the next tree level
            treeShas.push(currentTreeSha);
            console.log(`[delete-item] Found segment '${segment}', next tree SHA: ${currentTreeSha}`);
        }
        
        const parentTreeSha = currentTreeSha; // SHA of the immediate parent directory
        console.log(`[delete-item] Parent directory tree SHA: ${parentTreeSha}`);

        // 4. Modify the parent tree (remove the target item)
        const parentTreeContent = await getTree(parentTreeSha);
        const originalParentSize = parentTreeContent.length;
        const newParentTreeDefinition = parentTreeContent
            .filter(item => item.path !== itemName)
            .map(item => ({ // Map to API format
                 path: item.path,
                 mode: item.mode,
                 type: item.type,
                 sha: item.sha,
            }));
        
        if (newParentTreeDefinition.length === originalParentSize) {
            // Item wasn't actually in the parent directory listing
            console.log(`[delete-item] Item '${itemName}' not found in parent tree SHA: ${parentTreeSha}`);
             return res.status(404).json({ error: `Item '${itemName}' not found in directory '${parentPathSegments.join('/')|| '/'}'.` });
        }

        console.log(`[delete-item] Creating new parent tree definition (size ${newParentTreeDefinition.length})`);
        let newLowerTreeSha = await createTree(newParentTreeDefinition);

        // 5. Propagate changes back up the tree
        // Iterate backwards through the path segments and the SHAs we stored
        for (let i = parentPathSegments.length - 1; i >= 0; i--) {
            const segmentNameToUpdate = parentPathSegments[i];
            const currentLevelTreeSha = treeShas[i]; // The tree *containing* the entry we need to update
            
            console.log(`[delete-item] Propagating change: Updating entry '${segmentNameToUpdate}' in tree ${currentLevelTreeSha} to point to ${newLowerTreeSha}`);
            
            const currentLevelContent = await getTree(currentLevelTreeSha);
            const newLevelDefinition = currentLevelContent.map(item => {
                if (item.path === segmentNameToUpdate && item.type === 'tree') {
                    // Update the SHA for the directory entry we just modified below this level
                    return { ...item, sha: newLowerTreeSha }; 
                }
                return item; // Keep other items the same
            }).map(item => ({ // Map to API format
                 path: item.path,
                 mode: item.mode,
                 type: item.type,
                 sha: item.sha,
            }));

            newLowerTreeSha = await createTree(newLevelDefinition); // This new SHA represents the updated current level tree
        }
        
        // After the loop, newLowerTreeSha holds the new ROOT tree SHA
        const newRootTreeSha = newLowerTreeSha;
        console.log(`[delete-item] New root tree SHA: ${newRootTreeSha}`);
        
        if (newRootTreeSha === rootTreeSha) {
             // Should not happen if item was found and removed, indicates an error in propagation logic
             console.error(`[delete-item] Error: Root tree SHA did not change after propagation. Original: ${rootTreeSha}, New: ${newRootTreeSha}`);
             return res.status(500).json({ error: 'Internal server error: Failed to update tree structure correctly.' });
        }

        // 6. Create the commit
        console.log(`[delete-item] Creating final commit object...`);
        const createCommitUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`;
        const finalCommitMessage = `${message} [author: ${username}]`;
        const createCommitPayload = {
            message: finalCommitMessage,
            tree: newRootTreeSha,
            parents: [latestCommitSha],
        };
        const createCommitResponse = await axios.post(createCommitUrl, createCommitPayload, { headers });
        const newCommitSha = createCommitResponse.data.sha;
        console.log(`[delete-item] New commit SHA: ${newCommitSha}`);

        // --- Auto Tagging (Patch Bump) --- (NEW)
        let newTagName = null;
        let tagResult = { success: false, error: 'Tagging skipped or failed.' };
        try {
            const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
            console.log('[delete-item] Fetching existing tags for auto-bump...');
            const tagsResponse = await axios.get(tagsUrl, { headers });
            const latestTag = getLatestSemanticTag(tagsResponse.data);
            console.log(`[delete-item] Latest tag found: ${latestTag || 'None'}`);
            newTagName = incrementVersion(latestTag || '0.0.0', 'patch'); // Force patch bump
            console.log(`[delete-item] Calculated next tag (patch): ${newTagName}`);

            if (newTagName && newCommitSha) {
                tagResult = await createTagReference(newTagName, newCommitSha, auth); // Tag the NEW commit
            } else {
                tagResult.error = 'Could not calculate new tag name.';
            }
        } catch (tagLookupError) {
            console.error('[delete-item] Error during tag lookup/calculation:', tagLookupError.message);
            tagResult.error = 'Error processing existing tags.';
        }
        // --- End Auto Tagging ---

        // 7. Update branch reference
        console.log(`[delete-item] Updating branch reference '${branch}' to ${newCommitSha}`);
        const updateRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branch}`;
        await axios.patch(updateRefUrl, { sha: newCommitSha }, { headers });
        console.log(`[delete-item] Branch '${branch}' updated successfully.`);

        // Adjust final message based on tagging success (NEW)
        let finalMessage = `Item at path '${path}' deleted successfully.`;
        if (tagResult.success) {
            finalMessage += ` New state tagged as ${newTagName}.`;
            res.status(200).json({ success: true, message: finalMessage, commit: createCommitResponse.data });
        } else {
            finalMessage += ` Failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`;
            // Send 207 since branch update succeeded but tag failed
            res.status(207).json({ success: true, message: finalMessage, commit: createCommitResponse.data, tagError: tagResult.error });
        }
        console.log(`[delete-item] Update complete. Final status: ${tagResult.success ? 'Tagged' : 'Tag failed'}`);

    } catch (error) {
        console.error(`[delete-item] Error deleting path '${path}' on branch '${branch}':`, error); // Log the whole error
        const errorMsg = error.message || 'An unexpected error occurred during deletion.';
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json({ error: errorMsg });
    }
});

// POST /update-account-status - Activate, deactivate, delete, OR update permissions
app.post('/update-account-status', async (req, res) => {
  const { adminUsername, adminPassword, targetUsername, action, branch_permissions } = req.body; 

  // --- Validation ---
  if (!adminUsername || !adminPassword || !targetUsername) {
    return res.status(400).json({ error: 'Missing required fields: adminUsername, adminPassword, targetUsername' });
  }
  const validActions = ['activate', 'deactivate', 'delete', 'update_perms']; // Add update_perms
  const hasValidAction = action && validActions.includes(action);
  // Check if branch_permissions exists and is an array (even if empty)
  const hasPermissionsUpdate = branch_permissions !== undefined && Array.isArray(branch_permissions);

  if (!hasValidAction && !hasPermissionsUpdate) {
      return res.status(400).json({ error: 'Invalid request: Must provide a valid action (activate/deactivate/delete/update_perms) or branch_permissions array.' });
  }

  // Admin Validation 
  if (adminUsername !== 'admin') {
      return res.status(403).json({ error: 'Permission denied: Only admin can manage user accounts.' });
  }
   const adminValidation = await validateUser(adminUsername, adminPassword);
   if (!adminValidation.valid) {
       return res.status(403).json({ error: 'Admin authentication failed.' });
   }

  // Prevent admin from deactivating/deleting/changing permissions of themselves
  if (targetUsername === 'admin') {
    return res.status(400).json({ error: 'Cannot modify the primary admin account via this method.' });
  }

  // --- Database Interaction --- 
  try {
    const updates = [];
    const queryParams = [];
    let paramIndex = 1; // Start parameter index at 1
    let messages = [];

    // Handle Activate/Deactivate
    if (action === 'activate') {
      updates.push(`active = $${paramIndex++}`);
      queryParams.push(true);
      messages.push('activated');
    } else if (action === 'deactivate') {
      updates.push(`active = $${paramIndex++}`);
      queryParams.push(false);
      messages.push('deactivated');
    }

    // Handle Branch Permissions Update
    if (hasPermissionsUpdate) {
      // Ensure permissions is an array of strings
      const sanitizedPermissions = branch_permissions.filter(p => typeof p === 'string');
      // Assuming branch_permissions column is TEXT[] in PostgreSQL
      updates.push(`branch_permissions = $${paramIndex++}`); 
      queryParams.push(sanitizedPermissions); // Pass array directly for TEXT[] type
      messages.push('permissions updated');
    }

    let queryText = '';
    if (action === 'delete') {
      // --- Delete User --- 
      console.log(`[update-account-status] Attempting to delete user: ${targetUsername}`);
      queryText = 'DELETE FROM users WHERE username = $1';
      queryParams.splice(0, queryParams.length, targetUsername); // Replace params with just username
      messages = ['deleted']; 
    } else if (updates.length > 0) {
      // --- Update User --- 
      console.log(`[update-account-status] Attempting to update user: ${targetUsername} with actions: ${messages.join(', ')}`);
      queryText = `UPDATE users SET ${updates.join(', ')} WHERE username = $${paramIndex}`; // WHERE clause uses the next index
      queryParams.push(targetUsername); // Add username as the last parameter
    } else {
       return res.status(400).json({ error: 'No valid update action specified.' });
    }

     console.log(`[update-account-status] Executing Query: ${queryText} with Params:`, queryParams);
     const result = await pgClient.query(queryText, queryParams);

    if (result.rowCount === 0 && action !== 'delete') { // Don't error if delete target not found
        return res.status(404).json({ error: `Target user '${targetUsername}' not found.` });
    } else if (action === 'delete' && result.rowCount === 0) {
         console.log(`[update-account-status] User '${targetUsername}' not found for deletion, proceeding silently.`);
         messages = ['not found for deletion']; // Adjust message if needed
    }

    res.status(200).json({ success: true, message: `User '${targetUsername}' successfully ${messages.join(' and ')}.` });

  } catch (error) {
    console.error(`[update-account-status] Error processing request for user '${targetUsername}':`, error);
    res.status(500).json({ error: 'Database error during user account update.' });
  }
});


// ----------------------------------------
// DB/users interaction helper functions
// ----------------------------------------

// Check to make sure the users table exists and create it if not
async function ensureUsersTableExists() {
  try {
    // Check if the "users" table exists in the public schema.
    const result = await pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
      ) AS "exists"
    `);

    if (result.rows[0].exists) {
      // console.log('users table found');
    } else {
      // Create the table if it doesn't exist.
      await pgClient.query(`
        CREATE TABLE users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) NOT NULL UNIQUE,
          email VARCHAR(255),
          password_hash VARCHAR(255) NOT NULL,
          branch_permissions TEXT[] NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          last_login TIMESTAMP WITH TIME ZONE,
          active BOOLEAN DEFAULT FALSE
        );
      `);
      console.log('users table created');
    }
  } catch (err) {
    console.error('Error ensuring users table exists:', err);
  }
}

// Create a new user
app.post('/new_user', async (req, res) => {
  const { username, email, password, branch_permissions } = req.body;

  // Validate required fields
  if (!username || !password || !branch_permissions) {
    return res.status(400).json({ error: 'username, password, and branch_permissions are required' });
  }

  try {
    // Hash the password with bcrypt
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // SQL query to insert the new user into the 'users' table
    const queryText = `
      INSERT INTO users (username, email, password_hash, branch_permissions)
      VALUES ($1, $2, $3, $4)
      RETURNING id, username, email, branch_permissions, created_at;
    `;
    const values = [username, email || null, password_hash, branch_permissions];

    const result = await pgClient.query(queryText, values);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    // Check for duplicate username error (unique constraint violation)
    if (error.code === '23505') {
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
});

// Validate user credentials and branch permissions
async function validateUser(username, password, branch) {
  console.log('validating user')
  try {
    // Retrieve the user from the database by username.
    const queryText = 'SELECT * FROM users WHERE username = $1';
    const result = await pgClient.query(queryText, [username]);

    // If no user is found, validation fails.
    if (result.rows.length === 0) {
      return { valid: false, reason: 'User not found' };
    }

    const user = result.rows[0];

    // Check if the account is active.
    if (!user.active) {
      return { valid: false, reason: 'Account is inactive' };
    }

    // Validate the password using bcrypt.
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return { valid: false, reason: 'Invalid password' };
    }

    // Check branch permissions ONLY if user is not admin and a branch is provided
    if (username !== 'admin' && branch && 
        (!user.branch_permissions || !user.branch_permissions.includes(branch))) {
      return { valid: false, reason: 'Branch not permitted' };
    }

    // Everything checks out; update last_login timestamp.
    const updateQuery = `
      UPDATE users 
      SET last_login = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $1 
      RETURNING last_login, updated_at
    `;
    const updateResult = await pgClient.query(updateQuery, [user.id]);

    // Update user object with the new last_login (and updated_at) values.
    user.last_login = updateResult.rows[0].last_login;
    user.updated_at = updateResult.rows[0].updated_at;

    // If all checks pass, return a success response.
    return { valid: true, user };
  } catch (error) {
    console.error('Error during user validation:', error);
    return { valid: false, reason: 'Error during validation' };
  }
}


// POST /rename-item - Renames a file or folder within the same branch (Level-by-Level)
app.post('/rename-item', async (req, res) => {
    const { username, password, branch, originalPath, newName } = req.body;

    // --- Basic Validation ---
    if (!username || !password || !branch || !originalPath || !newName) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }
    if (newName.includes('/') || newName.includes('\\') || !newName.trim()) {
        return res.status(400).json({ error: 'Invalid new name.' });
    }
    if (originalPath === '/' || originalPath === '' || originalPath.startsWith('.') || originalPath.includes('..')) {
         return res.status(400).json({ error: 'Invalid original path.' });
    }

    const pathSegments = originalPath.split('/').filter(Boolean);
    const originalName = pathSegments.pop(); // Item name to rename
    const parentPathSegments = pathSegments; // Path to the parent directory
    const parentPath = parentPathSegments.join('/'); // String representation of parent path
    const newPath = parentPath ? `${parentPath}/${newName}` : newName; // Construct full new path

    if (!originalName) {
        return res.status(400).json({ error: 'Invalid original path provided.' });
    }
    if (originalPath === newPath) {
         return res.status(400).json({ error: 'New name cannot be the same as the original name.' });
    }

    // Validate user credentials and branch access
    const validationResult = await validateUser(username, password, branch);
    if (!validationResult.valid) {
        return res.status(403).json({ error: validationResult.reason });
    }

    // --- GitHub API Setup ---
    const auth = { username: process.env.GITHUB_USERNAME, password: process.env.GITHUB_TOKEN };
    const headers = { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' };
    const commitMessage = `Rename ${originalPath} to ${newPath} [author: ${username}]`;

    try {
        // 1. Get latest commit and root tree SHA
        console.log(`[rename-item] Fetching ref for branch: ${branch}`);
        const refUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branch}`;
        const refResponse = await axios.get(refUrl, { headers });
        const latestCommitSha = refResponse.data.object.sha;
        console.log(`[rename-item] Latest commit SHA: ${latestCommitSha}`);

        const commitUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${latestCommitSha}`;
        const commitResponse = await axios.get(commitUrl, { headers });
        const rootTreeSha = commitResponse.data.tree.sha;
        console.log(`[rename-item] Root tree SHA: ${rootTreeSha}`);

        // 2. Traverse down to the parent directory
        let currentTreeSha = rootTreeSha;
        const treeShas = [rootTreeSha]; // Store SHAs as we go down

        console.log(`[rename-item] Traversing path segments to parent: ${parentPath}`);
        for (const segment of parentPathSegments) {
            const currentTreeContent = await getTree(currentTreeSha, headers);
            const entry = currentTreeContent.find(item => item.path === segment && item.type === 'tree');
            if (!entry) {
                console.log(`[rename-item] Path segment '${segment}' not found or not a tree in SHA: ${currentTreeSha}`);
                return res.status(404).json({ error: `Path not found: Could not find directory '${segment}' in '${parentPathSegments.slice(0, parentPathSegments.indexOf(segment)).join('/')}'.` });
            }
            currentTreeSha = entry.sha; // Move to the next tree level
            treeShas.push(currentTreeSha);
            console.log(`[rename-item] Found segment '${segment}', next tree SHA: ${currentTreeSha}`);
        }

        const parentTreeSha = currentTreeSha; // SHA of the immediate parent directory
        console.log(`[rename-item] Parent directory tree SHA: ${parentTreeSha}`);

        // 3. Modify the parent tree: remove old name, add new name with old SHA
        const parentTreeContent = await getTree(parentTreeSha, headers);

        // Find the item to rename
        const itemToRename = parentTreeContent.find(item => item.path === originalName);
        if (!itemToRename) {
            console.log(`[rename-item] Item '${originalName}' not found in parent tree SHA: ${parentTreeSha}`);
            return res.status(404).json({ error: `Item '${originalName}' not found in directory '${parentPath || '/'}'.` });
        }
        console.log(`[rename-item] Found item to rename: ${originalName} (Type: ${itemToRename.type}, SHA: ${itemToRename.sha})`);

        // Check if new name already exists
        const newItemExists = parentTreeContent.some(item => item.path === newName);
        if (newItemExists) {
            console.log(`[rename-item] Conflict: '${newName}' already exists in parent tree SHA: ${parentTreeSha}`);
            return res.status(409).json({ error: `An item named '${newName}' already exists in directory '${parentPath || '/'}'.` });
        }

        // Create the new parent tree definition
        const newParentTreeDefinition = parentTreeContent
            .filter(item => item.path !== originalName) // Remove the original item
            .map(item => ({ // Map existing items to API format
                 path: item.path,
                 mode: item.mode,
                 type: item.type,
                 sha: item.sha,
            }));

        // Add the new item entry pointing to the original item's SHA
        newParentTreeDefinition.push({
            path: newName,
            mode: itemToRename.mode,
            type: itemToRename.type,
            sha: itemToRename.sha, // Use the SHA of the original blob or tree
        });

        console.log(`[rename-item] Creating new parent tree definition (size ${newParentTreeDefinition.length})`);
        let newLowerTreeSha = await createTree(newParentTreeDefinition, headers);

        // 4. Propagate changes back up the tree
        for (let i = parentPathSegments.length - 1; i >= 0; i--) {
            const segmentNameToUpdate = parentPathSegments[i];
            const currentLevelTreeSha = treeShas[i]; // The tree *containing* the entry we need to update

            console.log(`[rename-item] Propagating change: Updating entry '${segmentNameToUpdate}' in tree ${currentLevelTreeSha} to point to ${newLowerTreeSha}`);

            const currentLevelContent = await getTree(currentLevelTreeSha, headers);
            const newLevelDefinition = currentLevelContent.map(item => {
                if (item.path === segmentNameToUpdate && item.type === 'tree') {
                    // Update the SHA for the directory entry we just modified below this level
                    return { path: item.path, mode: item.mode, type: item.type, sha: newLowerTreeSha };
                }
                // Keep other items the same
                return { path: item.path, mode: item.mode, type: item.type, sha: item.sha };
            });

            newLowerTreeSha = await createTree(newLevelDefinition, headers); // This new SHA represents the updated current level tree
        }

        // After the loop, newLowerTreeSha holds the new ROOT tree SHA
        const newRootTreeSha = newLowerTreeSha;
        console.log(`[rename-item] New root tree SHA: ${newRootTreeSha}`);

        if (newRootTreeSha === rootTreeSha) {
             // This *could* happen if the rename resulted in the exact same tree structure (e.g. case-only rename on case-insensitive FS?)
             // But generally indicates an error.
             console.error(`[rename-item] Error: Root tree SHA did not change after propagation. Original: ${rootTreeSha}, New: ${newRootTreeSha}`);
             // Let's allow it but log a warning, maybe GitHub optimized? Better to proceed than fail here.
             // return res.status(500).json({ error: 'Internal server error: Failed to update tree structure correctly.' });
             console.warn(`[rename-item] Warning: Root tree SHA did not change after rename operation. Proceeding...`);
        }

        // 5. Create the commit
        console.log(`[rename-item] Creating final commit object...`);
        const createCommitUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`;
        const createCommitPayload = {
            message: commitMessage,
            tree: newRootTreeSha,
            parents: [latestCommitSha],
        };
        const createCommitResponse = await axios.post(createCommitUrl, createCommitPayload, { headers });
        const newCommitSha = createCommitResponse.data.sha;
        console.log(`[rename-item] New commit SHA: ${newCommitSha}`);

        // 6. Auto Tagging (Patch Bump)
        let newTagName = null;
        let tagResult = { success: false, error: 'Tagging skipped or failed.' };
        try {
            const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
            const tagsResponse = await axios.get(tagsUrl, { headers });
            const latestTag = getLatestSemanticTag(tagsResponse.data);
            newTagName = incrementVersion(latestTag || '0.0.0', 'patch');
            if (newTagName && newCommitSha) {
                tagResult = await createTagReference(newTagName, newCommitSha, auth);
            } else { tagResult.error = 'Could not calculate new tag name or missing commit SHA.'; }
        } catch (tagLookupError) {
             console.error('[rename-item] Error during tag lookup/calculation:', tagLookupError.message);
             tagResult.error = 'Error processing existing tags.';
        }

        // 7. Update branch reference
        console.log(`[rename-item] Updating branch reference '${branch}' to ${newCommitSha}`);
        const updateRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branch}`;
        await axios.patch(updateRefUrl, { sha: newCommitSha }, { headers });
        console.log(`[rename-item] Branch '${branch}' updated successfully.`);

        let finalMessage = `Item renamed to '${newPath}' successfully.`;
        if (tagResult.success) { finalMessage += ` New state tagged as ${newTagName}.`; }
        else { finalMessage += ` Failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`; }

        res.status(tagResult.success ? 200 : 207).json({
            success: true, message: finalMessage,
            commit: createCommitResponse.data, // Send back commit info
            ...(tagResult.error && { tagError: tagResult.error })
        });

    } catch (error) {
        console.error(`[rename-item] Error renaming '${originalPath}' to '${newPath}':`, error.response?.data || error.message || error);
        // Use status from GitHub error if available, otherwise 500
        const statusCode = error.response?.status || (error.message?.includes('fetch tree data') ? 404 : 500); 
        const errorDetail = error.response?.data?.message || error.message || 'An unexpected error occurred.';
        res.status(statusCode).json({
             error: `Failed to rename item. ${errorDetail}`
        });
    }
});

// POST /upload-files - Upload multiple files to a specified directory
app.post('/upload-files', async (req, res) => {
    console.log('[upload-files] === Received request ==='); // Keep log line
    const { username, password, branch, targetDirectory, files } = req.body;

    // --- Validation --- (Copied from previous attempt)
    if (!username || !password || !branch || targetDirectory === undefined || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({
            error: 'Missing required fields: username, password, branch, targetDirectory, and a non-empty files array are required.',
        });
    }
    if (!files.every(f => typeof f.name === 'string' && typeof f.content === 'string' && f.name && !f.name.includes('/'))) {
         return res.status(400).json({ error: 'Invalid file data in array. Each file must have a valid name (no slashes) and base64 content.' });
    }

    // Validate user credentials and branch access
    const validationResult = await validateUser(username, password, branch);
    if (!validationResult.valid) {
        return res.status(403).json({ error: validationResult.reason });
    }

    // --- GitHub API Interaction --- (Copied from previous attempt)
    const auth = {
        username: process.env.GITHUB_USERNAME,
        password: process.env.GITHUB_TOKEN,
    };
    const headers = { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' };

    const uploadResults = [];
    let lastCommitSha = null; 

    console.log(`[upload-files] Starting upload for ${files.length} files to ${branch}:${targetDirectory} by ${username}`);

    try {
        for (const file of files) {
            const filePath = targetDirectory ? `${targetDirectory}/${file.name}` : file.name;
            const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
            const commitMessage = `Upload file: ${filePath} [author: ${username}]`;

            let currentSha = null;
            try {
                console.log(`[upload-files] Checking existing file: ${filePath}`);
                const getResp = await axios.get(`${url}?ref=${branch}`, { headers }); 
                currentSha = getResp.data.sha;
                console.log(`[upload-files] File exists, SHA: ${currentSha}. Will overwrite.`);
            } catch (err) {
                if (err.response?.status !== 404) {
                     console.error(`[upload-files] Error checking file ${filePath}:`, err.response?.data || err.message);
                     uploadResults.push({ name: file.name, path: filePath, status: 'error', reason: `Failed to check existing file: ${err.response?.data?.message || err.message}` });
                     continue; 
                }
                console.log(`[upload-files] File does not exist. Will create.`);
            }

            const putPayload = {
                message: commitMessage,
                content: file.content, 
                branch: branch,
                ...(currentSha ? { sha: currentSha } : {}), 
            };

            try {
                console.log(`[upload-files] Uploading ${filePath}...`);
                const putResp = await axios.put(url, putPayload, { auth }); 
                lastCommitSha = putResp.data.commit.sha; 
                uploadResults.push({
                    name: file.name,
                    path: filePath,
                    status: currentSha ? 'updated' : 'created',
                    sha: lastCommitSha,
                    url: putResp.data.content.html_url,
                });
                console.log(`[upload-files] Upload successful for ${filePath}. Commit SHA: ${lastCommitSha}`);
            } catch (putError) {
                console.error(`[upload-files] Error uploading ${filePath}:`, putError.response?.data || putError.message);
                uploadResults.push({
                    name: file.name,
                    path: filePath,
                    status: 'error',
                    reason: putError.response?.data?.message || putError.message || 'Upload failed',
                });
            }
        } // End loop

        console.log('[upload-files] Finished processing all files.');

        // --- Auto Tagging --- (Copied from previous attempt)
        let newTagName = null;
        let tagResult = { success: false, error: 'Tagging skipped (no successful uploads or tagging failed).' };
        
        if (lastCommitSha) { 
            try {
                const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
                console.log('[upload-files] Fetching existing tags for auto-bump...');
                const tagsResponse = await axios.get(tagsUrl, { headers }); 
                const latestTag = getLatestSemanticTag(tagsResponse.data);
                console.log(`[upload-files] Latest tag found: ${latestTag || 'None'}`);
                newTagName = incrementVersion(latestTag || '0.0.0', 'patch'); 
                console.log(`[upload-files] Calculated next tag (patch): ${newTagName}`);

                if (newTagName) {
                    tagResult = await createTagReference(newTagName, lastCommitSha, auth); 
                } else {
                    tagResult.error = 'Could not calculate new tag name.';
                }
            } catch (tagLookupError) {
                console.error('[upload-files] Error during tag lookup/calculation:', tagLookupError.message);
                tagResult.error = 'Error processing existing tags.';
            }
        } else {
            console.log('[upload-files] Skipping tagging as no successful uploads occurred.');
        }

        // --- Determine Response --- (Copied from previous attempt)
        const errors = uploadResults.filter(r => r.status === 'error');
        let finalStatus = 200;
        let finalMessage = `Upload process completed.`;
        if (errors.length === files.length) {
             finalStatus = 500; 
             finalMessage = `Upload failed for all files.`;
        } else if (errors.length > 0) {
             finalStatus = 207; 
             finalMessage = `Upload partially completed with ${errors.length} error(s).`;
        } else {
            finalMessage = `All ${files.length} file(s) uploaded successfully.`;
        }
        
        if (lastCommitSha) { 
            if(tagResult.success) {
                finalMessage += ` New state tagged as ${newTagName}.`;
            } else {
                 finalMessage += ` Failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`;
                 if (finalStatus === 200) finalStatus = 207; 
            }
        }

        res.status(finalStatus).json({ 
            success: errors.length === 0, 
            message: finalMessage, 
            results: uploadResults,
            tag: tagResult.success ? newTagName : null,
            tagError: tagResult.error ? tagResult.error : undefined
        });

    } catch (error) {
        console.error('[upload-files] Unexpected error during upload process:', error.message);
        res.status(500).json({ error: 'An unexpected server error occurred during the upload process.' });
    }
});

// --- NEW: POST /diff-file - Compares file content between branches/local --- 
app.post('/diff-file', async (req, res) => {
  console.log('[diff-file] Received request');
  const { path, baseBranch, compareBranch, baseContent } = req.body;

  // Validate input
  if (!path || !baseBranch || !compareBranch || typeof baseContent !== 'string') {
    console.error('[diff-file] Missing required parameters in request body.');
    return res.status(400).json({ error: 'Missing required parameters: path, baseBranch, compareBranch, baseContent.' });
  }
  /* // Remove this check to allow diffing against the current branch's committed state
  if (baseBranch === compareBranch) {
    console.error('[diff-file] Base and compare branches cannot be the same.');
    return res.status(400).json({ error: 'Base branch and compare branch cannot be the same.' });
  }
  */

  console.log(`[diff-file] Comparing path: ${path} between base branch ${baseBranch} and compare branch ${compareBranch}`); // Updated log

  try {
    // 1. Fetch file content from the compareBranch
    let compareContent = '';
    try {
        const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${compareBranch}`;
        console.log(`[diff-file] Fetching file from GitHub for comparison: ${url}`);
        const response = await axios.get(url, { headers: githubHeaders });
        const contentBase64 = response.data.content.replace(/\n/g, '');
        const buffer = Buffer.from(contentBase64, 'base64');
        compareContent = buffer.toString('utf8');
        console.log(`[diff-file] Successfully fetched content from ${compareBranch}`);
    } catch (fetchError) {
        if (fetchError.response?.status === 404) {
            console.warn(`[diff-file] File ${path} not found on compare branch ${compareBranch}. Assuming empty content.`);
            compareContent = ''; // Treat as empty if not found on compare branch
        } else {
            console.error('[diff-file] Error retrieving file contents from compare branch:', fetchError.response?.data || fetchError.message);
            // Re-throw to be caught by the outer catch block
            throw new Error(`Failed to retrieve file contents for comparison from branch '${compareBranch}'`);
        }
    }

    // 2. Perform the diff
    console.log('[diff-file] Performing line diff...');
    // Compare compareBranch content (file on Github) vs baseContent (local editor content)
    const diffResult = Diff.diffLines(compareContent, baseContent);

    // 3. Format the result
    let formattedDiff = "";
    let hasChanges = false; // Track if any actual changes were found
    diffResult.forEach((part) => {
        const prefix = part.added ? '[+] ' : part.removed ? '[-] ' : '    '; // Add spaces for alignment
        if (part.added || part.removed) {
            hasChanges = true;
        }
        // Add prefix to each line within the part
        const lines = part.value.replace(/\r\n/g, '\n').split('\n'); // Normalize line endings
        // Handle potential trailing newline which results in an extra empty string element
        if (lines[lines.length - 1] === '') {
            lines.pop();
        }
        lines.forEach(line => {
            // Add comment marker unless the prefix indicates no change
            formattedDiff += `${prefix === '    ' ? '' : '// '}${prefix}${line}\n`; 
        });
    });

    // Add a message if no changes were detected
    if (!hasChanges) {
        formattedDiff = `// No differences found between ${baseBranch} (local) and ${compareBranch}.`;
    }

    console.log('[diff-file] Diff generation complete.');
    res.json({ diff: formattedDiff });

  } catch (error) {
    console.error('[diff-file] Unexpected error during diff generation:', error);
    res.status(500).json({ error: error.message || 'An unexpected error occurred during the diff process.' });
  }
});

// Connect to DB
const pgClient = new Client({
  connectionString: process.env.DATABASE_URL, // e.g., postgres://user:password@localhost:5432/dbname
});
pgClient.connect()
  .then(() => console.log('Connected to PostgreSQL'))
  .catch(err => console.error('PostgreSQL connection error', err));

// Ensure DB has a users table
ensureUsersTableExists();

// validateUser('admin', 'admin', 'main');


// ----------------------------------------
// Start the Server
// ----------------------------------------

const listEndpoints = (app) =>
  app._router.stack
    .filter((r) => r.route && r.route.path)
    .map((r) => {
      const methods = Object.keys(r.route.methods).join(',').toUpperCase();
      return `${methods} ${r.route.path}`;
    });

// console.log('→ Registered Express routes:\n' + listEndpoints(app).join('\n'));


NEXT_APP.prepare().then(() => {
  if (app._router && Array.isArray(app._router.stack)) {
    console.log('→ Registered Express routes:');
    app._router.stack.forEach(layer => {
      if (layer.route && layer.route.path) {
        const methods = Object
          .keys(layer.route.methods)
          .map(m => m.toUpperCase())
          .join(',');
        console.log(`  ${methods} ${layer.route.path}`);
      }
    });
  } else {
    console.log('(!) No Express routes found (app._router missing).');
  }
  // All unmatched routes (i.e. your React pages) go to Next
  app.all('*', (req, res) => handle(req, res));

  app.listen(PORT, err => {
    if (err) throw err;
    console.log(`> Single-server running on http://localhost:${PORT}`);
  });
});
