# Tournament

Tournament is a web application for organizing and managing sports tournaments. It provides authenticated users with a dashboard for tournaments, clubs, teams, members, matches, results, rankings, and statistics, with additional administration screens for creating tournaments and adding members.

The project is split into a React single-page application and a Node.js/Express API backed by PostgreSQL.

## Features

- User authentication with JWT tokens
- Role-based access for administrator-only actions
- Tournament creation and management
- Club, team, member, discipline, gender, role, state, and type management
- Match scheduling and score/result management
- Tournament rankings and player statistics
- Profile management
- HTTP request examples in `server/rest/`
- PostgreSQL schema versioning and seed data managed with Sqitch
- Production serving of the compiled frontend from the Express server

## Tech stack

- **Frontend:** React 18, React Router, Redux, Axios
- **Frontend tooling:** Webpack 5, Babel, Sass, PostCSS
- **Backend:** Node.js 18, Express 4
- **Database:** PostgreSQL with `pg`
- **Authentication and security:** JSON Web Tokens, bcrypt, Helmet
- **Validation and operations:** Joi, Nodemailer, Morgan, Debug, Nodemon
- **Database migrations:** Sqitch

## Project structure

```text
.
├── front/                 # React single-page application
│   ├── config/            # Webpack development and production configuration
│   ├── public/             # Static frontend assets and HTML template
│   └── src/
│       ├── components/     # Pages and reusable UI components
│       ├── config/         # API URLs and frontend runtime configuration
│       ├── reducers/       # Redux state reducers
│       ├── store/          # Redux store and API middleware
│       ├── styles/         # Shared styles
│       ├── test/           # Frontend test-related files
│       └── utils/          # Frontend utility functions
├── server/                # Express API and database tooling
│   ├── app/
│   │   ├── config/         # PostgreSQL connection pool
│   │   ├── controllers/    # Request handlers for domain resources
│   │   ├── datamappers/    # Database access functions
│   │   ├── routers/        # `/login` and versioned `/api/v1` routes
│   │   ├── schemas/        # Joi request-validation schemas
│   │   └── services/       # Authentication, validation, logging, errors, mail, and helpers
│   ├── rest/               # HTTP request examples for API resources
│   └── sqitch/             # PostgreSQL initialization, migrations, and seed data
├── docs/                   # Project, database, algorithm, and team documentation
└── package.json            # Root installation and runtime scripts
```

## How it works

The frontend starts at `front/src/index.js`, which mounts the React `App` inside `BrowserRouter` and the Redux `Provider`. `front/src/components/App/index.js` handles public and authenticated routes, restores JWT authentication from local storage, and exposes administrator-only routes such as tournament and member creation.

The backend starts at `server/app/index.js`. Express configures Helmet, CORS, JSON parsing, Morgan logging, static production assets, and the root router. API routes are mounted under `/api/v1`, while authentication is exposed under `/login`. Controllers validate input, call domain-specific datamappers, and use PostgreSQL through the pool configured in `server/app/config/database.js`.

In production, the frontend is built with Webpack and served by Express from the server's `public` directory. In development, Webpack Dev Server runs the frontend on port `8080` and the API runs on port `3001`.

## Requirements

- Node.js 18.x
- npm
- PostgreSQL and the `psql` client
- Sqitch with PostgreSQL support
- Bash for the database helper scripts

## Configuration

Create `server/.env` from `server/env.example`:

```dotenv
DATABASE_URL=postgres://user:password@localhost:5432/database
PORT=3001
JWTSECRET=replace-with-a-long-random-secret
AUTH_USER_EMAIL=email_login
AUTH_PWD_EMAIL=email_password
SENDER_EMAIL=email_sender_to_display
HOST_API=http://localhost:3001
```

The frontend uses `http://localhost:3001` and `http://localhost:3001/api/v1` in development. Review `front/src/config/index.js` if the API is hosted elsewhere.

## Installation

From the repository root:

```bash
npm install
```

The root `postinstall` script installs dependencies for both `front/` and `server/`, then builds the frontend.

To install each package independently:

```bash
cd front && npm install
cd ../server && npm install
```

## Database setup

Sqitch must be installed and PostgreSQL must be running. The initialization script creates the `tournament` database, creates the `tournament_admin` user, and initializes the Sqitch project:

```bash
cd server/sqitch
bash sqitch_init.sh
sqitch deploy
```

To load the example seed data after deploying the migrations:

```bash
cd ../..
npm run db-seed
```

The migration plan is in `server/sqitch/migrations/sqitch.plan`; deploy, revert, and verify scripts are stored in the corresponding subdirectories.

## Running the application

### Development

Start the API in one terminal:

```bash
npm run dev
```

Start the React development server in another:

```bash
cd front
npm start
```

Then open <http://localhost:8080>. The API is available at <http://localhost:3001>.

You can also start the API directly from the server package:

```bash
cd server
npm run dev
```

### Production

Build the frontend and start the Express server:

```bash
cd front
npm run build
cd ..
npm start
```

The production server listens on `PORT` or `3001` by default. When `NODE_ENV=production`, Express serves the compiled frontend and falls back to `index.html` for client-side routes.

## Useful commands

```bash
# Build the frontend
cd front && npm run build

# Lint the frontend
cd front && npm run lint

# Automatically fix frontend lint issues
cd front && npm run lint:fix

# Run the API in development mode
cd server && npm run dev

# Run the API in production mode
cd server && npm start

# Seed PostgreSQL with sample data
npm run db-seed
```

The server package includes Jest as a development dependency, but no test script is currently defined in `server/package.json`.

## API resources

The versioned API is mounted at `/api/v1` and includes routers for:

- Clubs
- Disciplines
- Genders
- Matches
- Results
- Roles
- Statistics
- States
- Teams
- Tournaments
- Types
- Users

Example requests are available as `.http` files in `server/rest/`, including `tournament.http`, `match.http`, `team.http`, `user.http`, and `stat.http`.

## Documentation

Additional project documentation is available in `docs/`, including:

- Database models under `docs/Database/`
- The project dossier in `docs/tournament-dossier-projet.md`
- Team progress notes in `docs/Journal de bord de l'équipe.md`
- Technical research notes in `docs/Veille.md`
- A tournament scheduling algorithm example in `docs/algo-tournament-all-vs-all.js`

## License

This project currently declares the `ISC` license in its package manifests.
