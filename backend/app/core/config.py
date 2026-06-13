import os
from dataclasses import dataclass, field


def _parse_csv_env(name: str, default: list[str]) -> list[str]:
    value = os.getenv(name)
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    app_name: str = "Analytica API"
    duckdb_path: str = "data/analytica.duckdb"
    cors_origins: list[str] = field(
        default_factory=lambda: _parse_csv_env(
            "ANALYTICA_CORS_ORIGINS",
            ["http://localhost:4200", "http://127.0.0.1:4200"],
        )
    )


settings = Settings(
    app_name=os.getenv("ANALYTICA_APP_NAME", "Analytica API"),
    duckdb_path=os.getenv("ANALYTICA_DUCKDB_PATH", "data/analytica.duckdb"),
)
