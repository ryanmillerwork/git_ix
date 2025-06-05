import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

interface LintIssue {
    line: number;
    column: number;
    message: string;
    type: 'error' | 'warning'; 
}

// Function to parse tclint's output string into an array of LintIssue objects
function parseLintOutput(stdout: string, tempFilePath: string): LintIssue[] {
    const issues: LintIssue[] = [];
    const lines = stdout.trim().split('\n');

    // Regex to capture: <tempFilePath>:<line>:<col>: <type> <message> (e.g., "style: line length...") or "syntax error: ..."
    // The file path at the start can be ignored since we know it.
    const regex = new RegExp(`^${tempFilePath}:(\\d+):(\\d+):\\s+(.*)$`);

    for (const line of lines) {
        const match = line.match(regex);
        if (match) {
            const fullMessage = match[3].trim();
            // Determine if it's a style warning or a syntax error
            const type = fullMessage.startsWith('syntax error') ? 'error' : 'warning';
            
            issues.push({
                line: parseInt(match[1], 10),
                column: parseInt(match[2], 10),
                message: fullMessage,
                type: type,
            });
        }
    }
    return issues;
}


export async function POST(request: Request) {
  let tempFilePath = '';

  try {
    const body = await request.json();
    const { code, language } = body;

    if (typeof code !== 'string' || typeof language !== 'string') {
      return NextResponse.json({ error: 'Invalid request: "code" and "language" must be strings.' }, { status: 400 });
    }

    if (language !== 'tcl') {
      return NextResponse.json({ error: `Linting not supported for language: ${language}` }, { status: 400 });
    }
    
    // --- TCL Linting Logic ---
    const homeDir = process.env.HOME;
    if (!homeDir) {
      console.error('[API lint-code] HOME environment variable not set.');
      return NextResponse.json({ error: 'Server configuration error: HOME not set.' }, { status: 500 });
    }

    const tempFileName = `lint-${uuidv4()}.tcl`;
    const tempDir = os.tmpdir();
    tempFilePath = path.join(tempDir, tempFileName);
    await fs.writeFile(tempFilePath, code, 'utf-8');
    
    const pythonInterpreter = path.resolve(homeDir, 'git_ix/tclint-env/bin/python');
    const tclintScript = path.resolve(homeDir, 'git_ix/tclint-env/bin/tclint');

    let command = `${pythonInterpreter} ${tclintScript} ${tempFilePath}`;

    console.log(`[API lint-code] Executing: ${command}`);

    const { stdout, stderr } = await execAsync(command);
    
    // According to tclint, exit code 1 means lint violations were found (sent to stdout).
    // The command was successful in this case, so we just parse the output.
    const issues = parseLintOutput(stdout, tempFilePath);
    return NextResponse.json({ issues, message: `Found ${issues.length} linting issues.` });

  } catch (error: any) {
    // This block catches errors from execAsync.
    // For tclint:
    // - Exit code 0: No issues. `execAsync` resolves, stdout is empty.
    // - Exit code 1: Lint issues found. `execAsync` resolves, stdout has issues.
    // - Exit code 2: Syntax error. `execAsync` REJECTS, stdout has error.
    
    // A rejection from execAsync with `stdout` content is likely a syntax error (exit code 2)
    if (error.stdout) {
        const issues = parseLintOutput(error.stdout, tempFilePath);
        return NextResponse.json(
            { issues, message: 'Failed to lint due to syntax errors.' }, 
            { status: 200 } // Return 200 but with error issues
        );
    }
    
    console.error('[API lint-code] Error during linting:', error.stderr || error.message);
    return NextResponse.json(
      { error: 'An unexpected server error occurred during linting.', details: error.stderr || error.message }, 
      { status: 500 }
    );
  } finally {
    // Cleanup
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch(e => console.warn(`[API lint-code] Failed to delete temp file: ${tempFilePath}`, e));
    }
  }
} 