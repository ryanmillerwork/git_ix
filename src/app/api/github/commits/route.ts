import { NextResponse } from 'next/server';
import axios from 'axios';
import * as semver from 'semver';
import { 
    GITHUB_API_BASE, 
    GITHUB_OWNER, 
    GITHUB_REPO, 
    githubAuthHeaders 
} from '@/lib/server/github'; // Adjust path as needed

export const dynamic = 'force-dynamic'; // Revalidate on every request

interface CommitInfo {
    id: string;
    version: string;
    date: string;
    time: string;
    author: string;
    message: string;
}

interface GitHubCommit {
    sha: string;
    commit: {
        author: { name?: string; email?: string; date?: string };
        committer?: { name?: string; email?: string; date?: string };
        message: string;
        tree: { sha: string; url: string };
        url: string;
        comment_count: number;
        verification?: { verified: boolean; reason: string; signature: string | null; payload: string | null };
    };
    url: string;
    html_url: string;
    comments_url: string;
    author: { login?: string; id?: number; /* ... other fields ... */ } | null;
    committer: { login?: string; id?: number; /* ... other fields ... */ } | null;
    parents: { sha: string; url: string; html_url?: string }[];
}

interface GitHubTag {
    name: string;
    commit: { sha: string; url: string };
    zipball_url: string;
    tarball_url: string;
    node_id: string;
}

/**
 * GET /api/github/commits
 * Returns recent commits/tags for a branch.
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const branch = searchParams.get('branch');

    console.log(`[API /github/commits] Fetching commits for branch: ${branch}`);

    if (!branch) {
        console.log('[API /github/commits] Error: Missing branch parameter.');
        return NextResponse.json({ error: 'Missing required query parameter: branch' }, { status: 400 });
    }

    const commitsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits?sha=${encodeURIComponent(branch)}&per_page=10`;
    const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;

    try {
        // 1. Fetch last 10 commits
        console.log(`[API /github/commits] Fetching commits from: ${commitsUrl}`);
        const commitsResponse = await axios.get<GitHubCommit[]>(commitsUrl, { headers: githubAuthHeaders });
        const commits = commitsResponse.data;

        // 2. Fetch all tags
        console.log(`[API /github/commits] Fetching tags from: ${tagsUrl}`);
        const tagsResponse = await axios.get<GitHubTag[]>(tagsUrl, { headers: githubAuthHeaders });
        const tags = tagsResponse.data;

        // 3. Create a map of commit SHA -> tag name (preferring valid semver tags)
        const commitShaToTagMap: { [sha: string]: string } = {};
        for (const tag of tags) {
            const existingTag = commitShaToTagMap[tag.commit.sha];
            const isNewTagSemver = semver.valid(tag.name);
            const isExistingTagSemver = existingTag && semver.valid(existingTag);

            if (!existingTag || 
                (isNewTagSemver && !isExistingTagSemver) || 
                (isNewTagSemver && isExistingTagSemver && semver.gt(tag.name, existingTag))) {
                commitShaToTagMap[tag.commit.sha] = tag.name;
            } else if (!existingTag && !isNewTagSemver) {
                commitShaToTagMap[tag.commit.sha] = tag.name; // Add non-semver only if no tag exists yet
            }
        }
        console.log(`[API /github/commits] Built tag map for ${Object.keys(commitShaToTagMap).length} commits.`);

        // 4. Process commits into the desired format
        const processedCommits: CommitInfo[] = commits.map(commit => {
            const sha = commit.sha;
            const commitData = commit.commit;
            // Use committer date if available, otherwise author date
            const commitDateStr = commitData.committer?.date || commitData.author?.date;
            const commitDate = commitDateStr ? new Date(commitDateStr) : new Date(); // Fallback to now if no date
            const commitMessage = commitData.message;

            console.log(`[API /github/commits] Processing commit message: "${commitMessage}"`); // DEBUG LOG

            // Extract author from message "[author: username]"
            const authorMatch = commitMessage.match(/\[author:\s*([^\\]]+)\]/);
            console.log(`[API /github/commits] authorMatch result: ${JSON.stringify(authorMatch)}`); // DEBUG LOG
            
            const extractedAuthor = authorMatch ? authorMatch[1].trim() : (commit.author?.login || 'N/A'); // Fallback
            console.log(`[API /github/commits] extractedAuthor: "${extractedAuthor}"`); // DEBUG LOG

            return {
                id: sha, // Use commit SHA as the unique ID
                version: commitShaToTagMap[sha] || 'N/A', // Get tag from map or 'N/A'
                date: commitDate.toLocaleDateString(),
                time: commitDate.toLocaleTimeString(),
                author: extractedAuthor,
                message: commitMessage,
            };
        });
        
        console.log(`[API /github/commits] Processed ${processedCommits.length} commits.`);
        return NextResponse.json(processedCommits);

    } catch (error: unknown) {
        let status = 500;
        let errorMessage = 'Failed to fetch commit history from GitHub.';
        
        if (axios.isAxiosError(error)) {
            console.error(`[API /github/commits] Axios error fetching commits/tags for branch '${branch}':`, error.response?.data || error.message);
            status = error.response?.status || 500;
            if (status === 404) {
                errorMessage = `Branch '${branch}' not found or repository inaccessible.`;
            } else if (status === 409) {
                 errorMessage = `Repository is empty or branch '${branch}' has no commits.`;
            }
        } else if (error instanceof Error) {
             console.error(`[API /github/commits] Error fetching commits/tags for branch '${branch}':`, error.message);
             errorMessage = error.message;
        } else {
             console.error(`[API /github/commits] Unexpected error fetching commits/tags for branch '${branch}':`, error);
        }

        return NextResponse.json({ error: errorMessage }, { status });
    }
} 