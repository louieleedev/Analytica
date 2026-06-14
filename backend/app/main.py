import logging

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.services.dataset_profile import build_column_profile, build_dataset_overview
from app.services.explorer_profile import (
    build_explorer_column_profile,
    build_explorer_dataset,
    build_explorer_filter_result,
)
from app.services.import_workflow import build_import_preview


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

    @app.post("/projects/import-preview", tags=["projects"])
    async def import_preview(
        import_method: str = Form(...),
        expected_file_type: str | None = Form(None),
        files: list[UploadFile] = File(...),
    ) -> dict:
        return await build_import_preview(files, import_method, expected_file_type)

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

    return app


app = create_app()
