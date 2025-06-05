import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export async function GET() {
  // Resolve paths using process.env.HOME for portability
  // Ensure process.env.HOME is available or provide a fallback if necessary for your server env
  const homeDir = process.env.HOME;
  if (!homeDir) {
    console.error('[API run-tclint-example] HOME environment variable not set.');
    return NextResponse.json(
      { error: 'Server configuration error: HOME environment variable not set.' },
      { status: 500 }
    );
  }

  const pythonInterpreter = path.resolve(homeDir, 'git_ix/tclint-env/bin/python');
  const tclintScript = path.resolve(homeDir, 'git_ix/tclint-env/bin/tclint');
  const exampleTclFile = path.resolve(homeDir, 'git_ix/tclint-env/example.tcl'); // Assuming this file exists

  // Construct the command
  const command = `${pythonInterpreter} ${tclintScript} ${exampleTclFile}`;

  console.log(`[API run-tclint-example] Executing command: ${command}`);

  try {
    // Execute the command
    // tclint typically outputs to stdout (for lint issues) and might use stderr for errors.
    // It usually exits with a non-zero code if lint issues are found.
    // For this example, we'll capture both and return them, even if execAsync throws due to exit code.
    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    try {
      const result = await execAsync(command);
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error: any) {
      // execAsync throws if the command exits with a non-zero code.
      // This is expected if tclint finds lint issues.
      stdout = error.stdout || '';
      stderr = error.stderr || 'Process exited with an error (see stdout for tclint output if any).';
      exitCode = error.code || 1;
      console.warn(`[API run-tclint-example] Command exited with code ${exitCode}. stdout: ${stdout}, stderr: ${stderr}`);
    }

    console.log(`[API run-tclint-example] Command stdout: ${stdout}`);
    if (stderr) {
      console.log(`[API run-tclint-example] Command stderr: ${stderr}`);
    }
    
    return NextResponse.json({
      message: `Command executed with exit code: ${exitCode}. Check stdout for lint results.`,
      stdout,
      stderr,
      exitCode
    });

  } catch (error: any) {
    // This catch block is for unexpected errors during execAsync setup or if something else goes wrong.
    console.error('[API run-tclint-example] Unexpected error executing tclint:', error);
    return NextResponse.json(
      { error: 'Failed to execute tclint command.', details: error.message },
      { status: 500 }
    );
  }
} 