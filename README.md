# Analytica

Analytica is a local analytics platform foundation for very large structured datasets such as SAP exports, ERP reports, financial data, audit data, CSV files, and Excel files.

This repository currently contains only the technical project foundation. Business features such as dataset import, filtering, pivot analysis, visualizations, and reports are intentionally not implemented yet.

## Tech Stack

- Frontend: Angular, TypeScript, Angular Material
- Backend: Python 3.14.6, FastAPI
- Database: DuckDB
- Data processing: Pandas, OpenPyXL

## Project Structure

```text
frontend/   Angular application
backend/    FastAPI application
docs/       Project documentation
scripts/    Local startup scripts
```

## Requirements

- Node.js compatible with Angular 20
- npm
- Python 3.14.6

## Run Locally

Start both services:

```powershell
.\scripts\start-dev.ps1
```

Or start them separately:

```powershell
.\scripts\start-backend.ps1
.\scripts\start-frontend.ps1
```

The frontend runs at:

```text
http://localhost:4200
```

The backend runs at:

```text
http://localhost:8000
```

Health check:

```text
GET http://localhost:8000/health
```

Expected response:

```json
{
  "status": "ok"
}
```

## Backend Development

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

## Frontend Development

```powershell
cd frontend
npm install
npm start
```

## Notes

- The application is designed to run locally.
- There is no cloud deployment, authentication, user management, or multi-user functionality.
- CORS is configured for the Angular dev server on port 4200.
