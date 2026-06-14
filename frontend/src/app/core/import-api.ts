import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import {
  ColumnProfile,
  DatasetFileType,
  ExplorerDataset,
  ExplorerFilterRequest,
  ExplorerFilterResult,
  DatasetOverview,
  ImportMethod,
  ImportPreview,
} from './import-workflow.models';

@Injectable({ providedIn: 'root' })
export class ImportApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = 'http://127.0.0.1:8000';

  createImportPreview(
    importMethod: ImportMethod,
    expectedFileType: DatasetFileType,
    files: File[],
  ) {
    const formData = new FormData();
    formData.append('import_method', importMethod);
    formData.append('expected_file_type', expectedFileType);

    for (const file of files) {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      formData.append('files', file, importMethod === 'folder' && relativePath ? relativePath : file.name);
    }

    return this.http.post<ImportPreview>(`${this.apiBaseUrl}/projects/import-preview`, formData);
  }

  getDatasetOverview(datasetId: string) {
    return this.http.get<DatasetOverview>(`${this.apiBaseUrl}/datasets/${datasetId}/overview`);
  }

  getColumnProfile(datasetId: string, columnName: string) {
    return this.http.get<ColumnProfile>(`${this.apiBaseUrl}/datasets/${datasetId}/columns/profile`, {
      params: { column_name: columnName },
    });
  }

  getExplorerDataset(datasetId: string) {
    return this.http.get<ExplorerDataset>(`${this.apiBaseUrl}/datasets/${datasetId}/explorer`);
  }

  getExplorerColumnProfile(datasetId: string, columnName: string) {
    return this.http.get<ColumnProfile>(
      `${this.apiBaseUrl}/datasets/${datasetId}/explorer/columns/profile`,
      {
        params: { column_name: columnName },
      },
    );
  }

  filterExplorerDataset(datasetId: string, payload: ExplorerFilterRequest) {
    return this.http.post<ExplorerFilterResult>(
      `${this.apiBaseUrl}/datasets/${datasetId}/explorer/filter`,
      payload,
    );
  }
}
