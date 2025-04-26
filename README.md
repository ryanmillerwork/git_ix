# Git Interaction (git_ix)

`git_ix` is a web-based interface built with Next.js designed to interact with a specific GitHub repository. It allows users to browse repository contents, view file diffs, manage branches, and commit changes through a user-friendly UI. User access and permissions are managed via a PostgreSQL database integration.

## Features

*   **Repository Browsing:** View folder structures and file contents.
*   **File Operations:** Add, rename, copy, and view diffs for files.
*   **Branch Management:** Create, view, revert, and retire branches.
*   **Committing:** Commit changes directly to the repository.
*   **GitHub Integration:** Leverages the GitHub API for all repository operations.
*   **User Management & Permissions (via PostgreSQL):** 
    *   Connects to a PostgreSQL database to manage users (`username`, `email`, hashed `password`).
    *   Controls user access based on an `active` status flag.
    *   Manages granular permissions per user via a `branch_permissions` array (text[]), restricting access to specific Git branches.

## API Endpoints

The application exposes several API endpoints under `/api/github/` to handle Git operations:

*   `/api/github/branches`: Manage repository branches.
*   `/api/github/folder-structure`: Fetch the directory structure.
*   `/api/github/file-contents`: Get the content of a specific file.
*   `/api/github/commits`: List commits for a branch.
*   `/api/github/commit-file`: Commit changes to a file.
*   `/api/github/diff-file`: Show differences for a file.
*   `/api/github/add-file`, `/api/github/add-folder`: Add new files/folders.
*   `/api/github/rename-item`: Rename files or folders.
*   `/api/github/copy-item-intra-branch`, `/api/github/copy-files`: Copy files/folders within or between branches.
*   `/api/github/upload-files`: Upload files to the repository.
*   `/api/github/create-branch`, `/api/github/revert-branch`, `/api/github/retire-branch`: Branch lifecycle management.

Other endpoints include:
*   `/api/users`: Handles user creation (`POST /new`), activation/deactivation (`PUT /update-status`), retrieval of all users (`GET /all`), and retrieval of active user names (`GET /`).
*   `/api/item`: Potentially related to specific item operations (needs further investigation).
*   `/api/health`, `/api/ping`: System status checks.

## Setup Instructions (Debian Environment)

Follow these steps to set up and run the `git_ix` application from scratch on a Debian-based system (like Ubuntu).

**1. Install Prerequisites:**

*   **Node.js and npm:**
    ```bash
    sudo apt update
    sudo apt install nodejs npm -y
    # Consider using nvm (Node Version Manager) for more flexible Node.js version management
    ```
*   **PostgreSQL:**
    ```bash
    sudo apt install postgresql postgresql-contrib -y
    sudo systemctl start postgresql
    sudo systemctl enable postgresql
    # Create a database and user (replace 'gitix_user' and 'your_password'/'gitix_db')
    sudo -u postgres psql -c "CREATE DATABASE gitix_db;"
    sudo -u postgres psql -c "CREATE USER gitix_user WITH ENCRYPTED PASSWORD 'your_password';"
    sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE gitix_db TO gitix_user;"
    ```
*   **Git:**
    ```bash
    sudo apt install git -y
    ```

**2. Clone the Repository:**

```bash
git clone https://github.com/ryanmillerwork/git_ix
cd git_ix
```

**3. Install Dependencies:**

```bash
npm install
# or if you prefer yarn or pnpm:
# yarn install
# pnpm install
```

**4. Configure Environment Variables:**

Create a `.env` file in the root of the project directory:

```bash
touch .env
```

Add the following variables to the `.env` file, replacing the placeholder values with your actual configuration:

```env
# GitHub Configuration
GITHUB_OWNER=<your_github_username_or_org>
GITHUB_REPO=<your_target_repository_name>
GITHUB_TOKEN=<your_github_personal_access_token> # Needs repo scope
# GITHUB_USERNAME=<your_github_username> # Optional, if using basic auth (PAT preferred)
# GITHUB_API_BASE=https://your-github-enterprise-url/api/v3 # Optional: For GitHub Enterprise

# Database Configuration
DATABASE_URL="postgresql://gitix_user:your_password@localhost:5432/gitix_db" # Adjust if your user/pass/db/host/port differ
```

*   **Important:** Ensure your `GITHUB_TOKEN` has the necessary permissions (e.g., `repo` scope) to interact with the target repository.
*   Adjust the `DATABASE_URL` if your PostgreSQL setup uses different credentials, host, or port.

**5. Database Setup:**

The application requires a PostgreSQL database with a `users` table. You will need to create this table manually. Based on the API routes (`src/app/api/users/`), the table should have at least the following columns:

*   `id`: Primary Key (e.g., SERIAL or UUID)
*   `username`: TEXT or VARCHAR, UNIQUE, NOT NULL
*   `email`: TEXT or VARCHAR, NULLABLE
*   `password_hash`: TEXT or VARCHAR, NOT NULL (stores bcrypt hash)
*   `branch_permissions`: TEXT[], NOT NULL, DEFAULT '{}' (stores an array of branch names the user can access)
*   `active`: BOOLEAN, NOT NULL, DEFAULT false
*   `created_at`: TIMESTAMP WITH TIME ZONE, DEFAULT CURRENT_TIMESTAMP

Example SQL for table creation (adapt types/constraints as needed):
```sql
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255),
    password_hash TEXT NOT NULL,
    branch_permissions TEXT[] NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

*After creating the table, you might need an initial admin user or use the API (`/api/users/new`) to create users.*

**6. Run the Development Server:**

```bash
npm run dev
# or
# yarn dev
# or
# pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to access the application.

**7. Build for Production:**

To create an optimized production build:

```bash
npm run build
```

To run the production server:

```bash
npm start
```