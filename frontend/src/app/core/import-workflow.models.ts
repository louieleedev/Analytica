export type DatasetFileType = 'CSV' | 'XLSX';
export type ImportMethod = 'files' | 'folder';
export type DetectedColumnType = 'Text' | 'Integer' | 'Decimal' | 'Date' | 'Boolean';
export type ColumnCategory = 'Measure' | 'Identifier' | 'Text' | 'Date';

export type ImportedFileInfo = {
  name: string;
  size: number;
  status: 'Schema Match' | 'Warning' | 'Error';
};

export type DetectedSchemaColumn = {
  name: string;
  type: DetectedColumnType;
  sourceFiles: string[];
  nullable: boolean;
  exampleValue: string | number | boolean | null;
};

export type DatasetPreview = {
  columns: string[];
  rows: Record<string, string | number | boolean | null>[];
};

export type ImportPreview = {
  datasetId: string;
  datasetType: DatasetFileType;
  fileCount: number;
  rowCount: number;
  columnCount: number;
  datasetSize: number;
  files: ImportedFileInfo[];
  schema: DetectedSchemaColumn[];
  preview: DatasetPreview;
};

export type OverviewColumn = {
  name: string;
  type: DetectedColumnType;
  category: ColumnCategory;
  distinctCount: number;
  nullCount: number;
  populatedPercentage: number;
};

export type DatasetOverview = {
  datasetId: string;
  summary: {
    totalRows: number;
    totalColumns: number;
    importedFiles: number;
    datasetSize: number;
  };
  columns: OverviewColumn[];
};

export type TopValue = {
  value: string;
  count: number;
  percentage?: number;
};

export type DistributionBucket = {
  label: string;
  count: number;
  percentage: number;
};

export type ColumnProfile = {
  name: string;
  type: DetectedColumnType;
  category: ColumnCategory;
  distinctValues: number;
  nullCount: number;
  topValues: TopValue[];
  topFrequencies?: TopValue[];
  mostFrequentIds?: TopValue[];
  min?: number | null;
  max?: number | null;
  average?: number | null;
  median?: number | null;
  sum?: number | null;
  standardDeviation?: number | null;
  distribution?: DistributionBucket[];
  earliestDate?: string | null;
  latestDate?: string | null;
  dateRange?: string | null;
  mostActiveMonth?: string | null;
  mostActiveYear?: string | null;
  timelineDistribution?: DistributionBucket[];
  uniquePercentage?: number | null;
  duplicatePercentage?: number | null;
};
