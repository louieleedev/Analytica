export type DatasetFileType = 'CSV' | 'XLSX';
export type ImportMethod = 'files' | 'folder';
export type DetectedColumnType = 'Text' | 'Integer' | 'Decimal' | 'Date' | 'Boolean';
export type ColumnCategory = 'Measure' | 'Identifier' | 'Text' | 'Date';
export type ExplorerColumnCategory = 'TYPE_VARIANT' | 'TIME_PERIOD' | 'AMOUNT' | 'IDENTIFIER';

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

export type ExplorerDataset = {
  datasetId: string;
  summary: {
    totalRows: number;
    rowsAfterFiltering: number;
    previewLimit: number;
  };
  columns: OverviewColumn[];
  preview: DatasetPreview;
};

export type ExplorerFilterType = DetectedColumnType;

export type ExplorerTextFilter = {
  columnName: string;
  type: 'Text' | 'Boolean';
  values: string[];
};

export type ExplorerNumericFilter = {
  columnName: string;
  type: 'Integer' | 'Decimal';
  min: number | null;
  max: number | null;
};

export type ExplorerDateFilter = {
  columnName: string;
  type: 'Date';
  from: string | null;
  to: string | null;
};

export type ExplorerTypeVariantFilter = {
  columnName: string;
  category: 'TYPE_VARIANT';
  values: string[];
};

export type ExplorerAmountFilter = {
  columnName: string;
  category: 'AMOUNT';
  min: number | null;
  max: number | null;
};

export type ExplorerTimePeriodFilter = {
  columnName: string;
  category: 'TIME_PERIOD';
  from: string | null;
  to: string | null;
  fromYear: number | null;
  toYear: number | null;
};

export type ExplorerIdentifierFilter = {
  columnName: string;
  category: 'IDENTIFIER';
  operator: 'Equals' | 'Contains' | 'Starts With' | 'Ends With';
  value: string;
};

export type ExplorerFilterPayload =
  | ExplorerTextFilter
  | ExplorerNumericFilter
  | ExplorerDateFilter
  | ExplorerTypeVariantFilter
  | ExplorerAmountFilter
  | ExplorerTimePeriodFilter
  | ExplorerIdentifierFilter;

export type ExplorerFilterRequest = {
  selectedColumns: string[];
  selectedCategories?: Record<string, ExplorerColumnCategory>;
  filters: ExplorerFilterPayload[];
  profileColumnName?: string | null;
  profileCategory?: ExplorerColumnCategory | null;
};

export type ExplorerFilterMetadata = {
  columnName: string;
  type: ExplorerFilterType;
  values?: TopValue[];
  min?: number | null;
  max?: number | null;
  from?: string | null;
  to?: string | null;
};

export type ExplorerFilterResult = {
  datasetId: string;
  summary: {
    totalRows: number;
    rowsAfterFiltering: number;
    previewLimit: number;
  };
  filterMetadata: ExplorerFilterMetadata[];
  preview: DatasetPreview;
  columnProfile?: ColumnProfile | null;
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
  explorerCategory?: ExplorerColumnCategory | null;
  rowCount?: number;
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
  uniqueValues?: number | null;
  duplicateValues?: number | null;
  uniquePercentage?: number | null;
  duplicatePercentage?: number | null;
};

export type PivotFieldRequest = {
  name: string;
  category: ExplorerColumnCategory | null;
  aggregation?: string;
};

export type PivotRequest = {
  rows: PivotFieldRequest[];
  columns: PivotFieldRequest[];
  values: PivotFieldRequest[];
  filters: ExplorerFilterPayload[];
};

export type PivotEstimate = {
  datasetId: string;
  rowCombinations: number;
  columnCombinations: number;
  projectedColumns: number;
  valueCount: number;
  rowCardinalities: Record<string, number>;
  columnCardinalities: Record<string, number>;
};

export type PivotResult = {
  datasetId: string;
  headers: string[];
  rows: (string | number | boolean | null)[][];
  rowCount: number;
  warnings: string[];
  sql?: string;
  pivot?: {
    rowFields: string[];
    columnFields: string[];
    columnValues: (string | number | boolean | null)[][];
    valueFields: string[];
  };
};

export type ChartType = 'bar' | 'pie' | 'line';
export type ChartAggregation = 'Sum' | 'Count' | 'Average' | 'Min' | 'Max';
export type ChartSortOrder = 'none' | 'ascending' | 'descending';

export type ChartRequest = {
  chartType: ChartType;
  categoryField: string;
  seriesField?: string | null;
  valueField: string;
  aggregation: ChartAggregation;
  sortOrder: ChartSortOrder;
  topN?: number | null;
  chartTitle?: string | null;
  filters: ExplorerFilterPayload[];
};

export type ChartPoint = {
  category: string;
  value: number;
};

export type ChartResult = {
  datasetId: string;
  chartType: ChartType;
  categoryField: string;
  seriesField?: string | null;
  valueField: string;
  aggregation: ChartAggregation;
  sortOrder: ChartSortOrder;
  topN?: number | null;
  title: string;
  metricLabel: string;
  points: ChartPoint[];
  series?: {
    name: string;
    points: ChartPoint[];
  }[];
  categories?: string[];
  seriesNames?: string[];
  pointCount: number;
  limit: number;
  sql?: string;
};

export type ApplicationSettings = {
  pivot_max_rows: number;
  table_density: string;
};

export type ApplicationSettingsResponse = {
  settings: ApplicationSettings;
  items: {
    key: keyof ApplicationSettings;
    value: number | string;
    updatedAt: string | null;
  }[];
};
