import logging

from pydantic import BaseModel, Field
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.services.dataset_profile import build_column_profile, build_dataset_overview
from app.services.explorer_profile import (
    build_explorer_column_profile,
    build_explorer_dataset,
    build_explorer_filter_result,
)
from app.services.dataset_storage import initialise_dataset_storage
from app.services.import_workflow import build_import_preview
from app.services.project_storage import (
    create_project_record,
    delete_project_record,
    get_project_record,
    initialise_project_storage,
    list_project_records,
    update_project_record,
)
from app.services.pivot_service import execute_pivot


class ProjectCreateRequest(BaseModel):
    name: str
    description: str
    dataset_id: str | None = Field(default=None, alias="datasetId")


class ProjectUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None


def create_app() -> FastAPI:
    logging.basicConfig(level=logging.INFO)
    app = FastAPI(title=settings.app_name)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.on_event("startup")
    def startup() -> None:
        initialise_dataset_storage()
        initialise_project_storage()

    @app.post("/projects/import-preview", tags=["projects"])
    async def import_preview(
        import_method: str = Form(...),
        expected_file_type: str | None = Form(None),
        files: list[UploadFile] = File(...),
    ) -> dict:
        return await build_import_preview(files, import_method, expected_file_type)

    @app.post("/projects", tags=["projects"])
    def create_project(payload: ProjectCreateRequest) -> dict:
        return create_project_record(
            payload.name.strip(),
            payload.description.strip(),
            payload.dataset_id,
        )

    @app.get("/projects", tags=["projects"])
    def list_projects() -> list[dict]:
        return list_project_records()

    @app.get("/projects/{project_id}", tags=["projects"])
    def get_project(project_id: str) -> dict:
        return get_project_record(project_id)

    @app.patch("/projects/{project_id}", tags=["projects"])
    def update_project(project_id: str, payload: ProjectUpdateRequest) -> dict:
        return update_project_record(
            project_id,
            payload.name.strip() if payload.name is not None else None,
            payload.description.strip() if payload.description is not None else None,
        )

    @app.delete("/projects/{project_id}", tags=["projects"])
    def delete_project(project_id: str) -> dict[str, str]:
        delete_project_record(project_id)
        return {"status": "deleted"}

    @app.get("/datasets/{dataset_id}/overview", tags=["datasets"])
    def dataset_overview(dataset_id: str) -> dict:
        return build_dataset_overview(dataset_id)

    @app.get("/datasets/{dataset_id}/columns/profile", tags=["datasets"])
    def dataset_column_profile(dataset_id: str, column_name: str) -> dict:
        return build_column_profile(dataset_id, column_name)

    @app.get("/datasets/{dataset_id}/explorer", tags=["datasets"])
    def dataset_explorer(dataset_id: str) -> dict:
        return build_explorer_dataset(dataset_id)

    @app.get("/datasets/{dataset_id}/explorer/columns/profile", tags=["datasets"])
    def dataset_explorer_column_profile(dataset_id: str, column_name: str) -> dict:
        return build_explorer_column_profile(dataset_id, column_name)

    @app.post("/datasets/{dataset_id}/explorer/filter", tags=["datasets"])
    def dataset_explorer_filter(dataset_id: str, payload: dict) -> dict:
        return build_explorer_filter_result(dataset_id, payload)

    @app.post("/datasets/{dataset_id}/pivot", tags=["datasets"])
    def dataset_pivot(dataset_id: str, payload: dict) -> dict:
        return execute_pivot(dataset_id, payload)

    return app


app = create_app()
