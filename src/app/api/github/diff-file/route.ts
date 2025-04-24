import { NextResponse } from 'next/server';
import axios from 'axios';
import * as Diff from 'diff'; // Import diff library
import { 
    GITHUB_API_BASE, 
    GITHUB_OWNER, 
    GITHUB_REPO, 
    githubAuthHeaders 
} from '@/lib/server/github'; // Adjust path as needed
// No user validation needed for diff endpoint

export const dynamic = 'force-dynamic'; // Revalidate on every request

/**
 * POST /api/github/diff-file
 * Compares file content between a base branch/content and a compare branch.
 */
export async function POST(request: Request) {
  console.log('[API /github/diff-file] Received request');
  let body;
  try {
    body = await request.json();
     console.log('[API /github/diff-file] Request body parsed:', { 
         path: body?.path, 
         baseBranch: body?.baseBranch, 
         compareBranch: body?.compareBranch, 
         hasBaseContent: typeof body?.baseContent === 'string' 
     });
  } catch (e) {
    console.error('[API /github/diff-file] Error parsing request body:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { path, baseBranch, compareBranch, baseContent } = body;

  // Validate input
  if (!path || !baseBranch || !compareBranch || typeof baseContent !== 'string') {
    console.error('[API /github/diff-file] Missing required parameters in request body.');
    return NextResponse.json({ error: 'Missing required parameters: path, baseBranch, compareBranch, baseContent.' }, { status: 400 });
  }

  console.log(`[API /github/diff-file] Comparing path: ${path} between base branch ${baseBranch} (local content) and compare branch ${compareBranch}`);

  try {
    // 1. Fetch file content from the compareBranch (treat as empty if not found)
    let compareContent = '';
    try {
        const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(compareBranch)}`;
        console.log(`[API /github/diff-file] Fetching file from GitHub for comparison: ${url}`);
        const response = await axios.get(url, { headers: githubAuthHeaders });
        
        // Decode base64 content
        if (response.data?.content && response.data?.encoding === 'base64') {
            const contentBase64 = response.data.content.replace(/\n/g, '');
            const buffer = Buffer.from(contentBase64, 'base64');
            compareContent = buffer.toString('utf8');
            console.log(`[API /github/diff-file] Successfully fetched content from ${compareBranch}`);
        } else {
             console.warn(`[API /github/diff-file] File ${path} found on ${compareBranch}, but content or encoding is invalid. Treating as empty.`);
             compareContent = '';
        }
    } catch (fetchError: any) {
        if (fetchError.response?.status === 404) {
            console.warn(`[API /github/diff-file] File ${path} not found on compare branch ${compareBranch}. Assuming empty content.`);
            compareContent = ''; // Treat as empty if not found on compare branch
        } else {
            console.error('[API /github/diff-file] Error retrieving file contents from compare branch:', fetchError.response?.data || fetchError.message);
            // Re-throw to be caught by the outer catch block
            throw new Error(`Failed to retrieve file contents for comparison from branch '${compareBranch}'`);
        }
    }

    // 2. Perform the line diff
    console.log('[API /github/diff-file] Performing line diff...');
    // Compare compareBranch content (file on Github) vs baseContent (local editor content)
    const diffResult = Diff.diffLines(compareContent, baseContent);

    // 3. Format the result for display
    let formattedDiff = "";
    let hasChanges = false; 
    diffResult.forEach((part: any) => {
        const prefix = part.added ? '[+] ' : part.removed ? '[-] ' : '    '; 
        if (part.added || part.removed) {
            hasChanges = true;
        }
        const lines = part.value.replace(/\r\n/g, '\n').split('\n');
        if (lines[lines.length - 1] === '') {
            lines.pop(); // Remove trailing empty string from split
        }
        lines.forEach((line: any) => {
            // Add comment marker for changed lines
            formattedDiff += `${prefix === '    ' ? '' : '// '}${prefix}${line}\n`; 
        });
    });

    // Add a message if no changes were detected
    if (!hasChanges) {
        // Distinguish between comparing against self vs. other branch
        if (baseBranch === compareBranch) {
             formattedDiff = `// No differences found between local changes and the committed version on branch ${compareBranch}.`;
        } else {
            formattedDiff = `// No differences found between local changes (base: ${baseBranch}) and branch ${compareBranch}.`;
        }
    }

    console.log('[API /github/diff-file] Diff generation complete.');
    return NextResponse.json({ diff: formattedDiff });

  } catch (error: any) {
    console.error('[API /github/diff-file] Unexpected error during diff generation:', error);
    return NextResponse.json({ error: error.message || 'An unexpected error occurred during the diff process.' }, { status: 500 });
  }
} 