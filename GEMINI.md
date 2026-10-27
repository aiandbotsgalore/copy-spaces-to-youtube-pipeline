# Project Overview

**SpacePipe Gen** (Twitter Space Ingest Pipeline Generator) is a React-based web application designed to help users generate configuration files for automating the archiving of Twitter Spaces.

The application provides an interactive form where users input metadata (repository details, podcast information, author details), and it dynamically generates the necessary files (GitHub Actions workflows, shell scripts, and documentation) to set up a fully automated "Twitter Spaces to YouTube/Podcast" pipeline.

# Tech Stack

*   **Framework:** [React](https://react.dev/) (v19)
*   **Build Tool:** [Vite](https://vitejs.dev/)
*   **Language:** [TypeScript](https://www.typescriptlang.org/)
*   **Styling:** [Tailwind CSS](https://tailwindcss.com/) (v4 integrated via `@tailwindcss/vite` and `@import "tailwindcss"` in `index.css`)
*   **Icons:** [Lucide React](https://lucide.dev/)

# Building and Running

## Prerequisites
*   Node.js (v18+ recommended)
*   npm

## Development

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Start Development Server:**
    ```bash
    npm run dev
    ```
    The application will run at `http://localhost:5000`.

## Production Build

1.  **Build the application:**
    ```bash
    npm run build
    ```
    Output will be generated in the `dist` directory.

2.  **Preview Production Build:**
    ```bash
    npm run preview
    ```

# Key Files & Structure

The project follows a flat directory structure where source files are located directly in the root or minimal subdirectories.

*   **`App.tsx`**: The main application component. Handles the state for configuration inputs (`EnhancedConfig` / `PipelineConfig`) and renders the dual-pane layout (sidebar for navigation, main area for form/preview).
*   **`utils/templates.ts`**: Contains the template literal functions that generate the actual string content for the output files (`ingest.yml`, `ingest.sh`, `README.md`, etc.). This is where the core logic for the "generator" resides.
*   **`components/FileViewer.tsx`**: A component responsible for rendering the generated code snippets with syntax highlighting or simple text display.
*   **`types.ts`**: Defines the TypeScript interfaces for the application state (`PipelineConfig` / `EnhancedConfig`) and the file structure (`PipelineFile`).
*   **`index.html`**: The application entry point. Loads `index.css` and font preconnects.

# Development Conventions

*   **Styling:** Use standard Tailwind CSS utility classes directly in JSX.
*   **State Management:** Local React state (`useState`) in `App.tsx` manages the configuration object.
*   **File Generation:** logical separation between the UI (`App.tsx`) and the content generation (`utils/templates.ts`). When adding new output files, add the generator function in `templates.ts` and register it in the `FILES` array in `App.tsx`.
*   **Imports:** The project uses path aliases (configured in `vite.config.ts`), though the current codebase primarily uses relative imports.

# YouTube Podcast & Audio Rules

*   **YouTube Duration Compliance:** All episodes (new or old) MUST comply with YouTube's 12-hour maximum upload limit. Any episode longer than 10 hours (36,000 seconds) must be sliced into sequential chunks labeled `(Part 1)`, `(Part 2)`, `(Part 3)`, etc.
*   **RSS Feed Separation:** Monolithic audio files exceeding 11h 58m must never enter `podcast.xml` (they belong in `podcast_archive.xml`).
*   **Highlight Clips Distinction:** Highlight clips (starting with timestamp patterns or `clip_`) must never be confused with multi-part episode chunks in `podcast.xml`. They belong exclusively in `clips.xml` and `public/clips/clips_catalog.json`.
