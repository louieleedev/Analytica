import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';

type ColumnType = 'text' | 'number' | 'date';

type PreviewColumn = {
  name: string;
  type: ColumnType;
  filterLabel: string;
};

type PreviewRow = Record<string, string>;

type ProfilerMetric = {
  label: string;
  value: string;
};

type ProfilerTopValue = {
  value: string;
  count: string;
};

type ProfilerDistribution = {
  label: string;
  value: string;
};

type ColumnProfile = {
  metrics: ProfilerMetric[];
  topValues: ProfilerTopValue[];
  distribution: ProfilerDistribution[];
};

@Component({
  selector: 'app-explorer',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSliderModule,
  ],
  templateUrl: './explorer.html',
})
export class Explorer {
  protected selectedColumnNames = new Set(['Country', 'AmountLocal', 'PostingDate']);
  protected selectedProfilerColumnName = 'AmountLocal';
  protected selectedTextValues: Record<string, string[]> = {
    Country: ['Germany', 'United States'],
  };
  protected numericRanges: Record<string, { min: string; max: string; start: number; end: number }> = {
    AmountLocal: { min: '-1,000,000', max: '5,000,000', start: 18, end: 82 },
  };
  protected dateRanges: Record<string, { from: string; to: string }> = {
    PostingDate: { from: '2026-01-01', to: '2026-12-31' },
  };

  protected readonly previewColumns: PreviewColumn[] = [
    { name: 'CompanyCode', type: 'text', filterLabel: 'Text Filter' },
    { name: 'Country', type: 'text', filterLabel: 'Text Filter' },
    { name: 'PostingDate', type: 'date', filterLabel: 'Date Filter' },
    { name: 'AccountNumber', type: 'text', filterLabel: 'Text Filter' },
    { name: 'CostCenter', type: 'text', filterLabel: 'Text Filter' },
    { name: 'AmountLocal', type: 'number', filterLabel: 'Numeric Filter' },
    { name: 'Currency', type: 'text', filterLabel: 'Text Filter' },
  ];

  protected readonly previewRows: PreviewRow[] = [
    {
      CompanyCode: '1000',
      Country: 'Germany',
      PostingDate: '2026-01-04',
      AccountNumber: '400100',
      CostCenter: 'CC-120',
      AmountLocal: '18,240.00',
      Currency: 'EUR',
    },
    {
      CompanyCode: '2200',
      Country: 'United States',
      PostingDate: '2026-01-04',
      AccountNumber: '510020',
      CostCenter: 'CC-210',
      AmountLocal: '-4,812.50',
      Currency: 'USD',
    },
    {
      CompanyCode: '3100',
      Country: 'United Kingdom',
      PostingDate: '2026-01-05',
      AccountNumber: '410050',
      CostCenter: 'CC-330',
      AmountLocal: '91,004.11',
      Currency: 'GBP',
    },
    {
      CompanyCode: '1400',
      Country: 'France',
      PostingDate: '2026-01-06',
      AccountNumber: '620010',
      CostCenter: 'CC-180',
      AmountLocal: '7,450.00',
      Currency: 'EUR',
    },
    {
      CompanyCode: '2800',
      Country: 'Japan',
      PostingDate: '2026-01-06',
      AccountNumber: '400100',
      CostCenter: 'CC-330',
      AmountLocal: '245,000.00',
      Currency: 'JPY',
    },
  ];

  // TODO: Replace these mock profiles with statistics supplied by FastAPI services backed by DuckDB.
  protected readonly profilerData: Record<string, ColumnProfile> = {
    CompanyCode: {
      metrics: [
        { label: 'Distinct Values', value: '18' },
        { label: 'Null Count', value: '0' },
      ],
      topValues: [
        { value: '1000', count: '12,420,904' },
        { value: '2200', count: '8,812,102' },
        { value: '3100', count: '6,104,880' },
      ],
      distribution: [
        { label: '1000', value: '42%' },
        { label: '2200', value: '30%' },
        { label: '3100', value: '21%' },
        { label: 'Other', value: '7%' },
      ],
    },
    Country: {
      metrics: [
        { label: 'Distinct Values', value: '42' },
        { label: 'Null Count', value: '0' },
      ],
      topValues: [
        { value: 'Germany', count: '14,802,104' },
        { value: 'United States', count: '11,441,002' },
        { value: 'France', count: '6,204,774' },
      ],
      distribution: [
        { label: 'Germany', value: '35%' },
        { label: 'United States', value: '27%' },
        { label: 'France', value: '15%' },
        { label: 'Other', value: '23%' },
      ],
    },
    PostingDate: {
      metrics: [
        { label: 'Distinct Values', value: '1,826' },
        { label: 'Null Count', value: '0' },
        { label: 'Earliest Date', value: '2021-01-01' },
        { label: 'Latest Date', value: '2026-12-31' },
      ],
      topValues: [
        { value: '2026-01-04', count: '184,902' },
        { value: '2026-01-05', count: '172,110' },
        { value: '2026-01-06', count: '168,020' },
      ],
      distribution: [
        { label: '2023', value: '18%' },
        { label: '2024', value: '26%' },
        { label: '2025', value: '31%' },
        { label: '2026', value: '25%' },
      ],
    },
    AccountNumber: {
      metrics: [
        { label: 'Distinct Values', value: '3,492' },
        { label: 'Null Count', value: '0' },
      ],
      topValues: [
        { value: '400100', count: '4,802,910' },
        { value: '510020', count: '3,114,802' },
        { value: '620010', count: '2,904,411' },
      ],
      distribution: [
        { label: 'Revenue', value: '42%' },
        { label: 'Expense', value: '33%' },
        { label: 'Asset', value: '17%' },
        { label: 'Other', value: '8%' },
      ],
    },
    CostCenter: {
      metrics: [
        { label: 'Distinct Values', value: '1,204' },
        { label: 'Null Count', value: '84,219' },
      ],
      topValues: [
        { value: 'CC-330', count: '3,420,884' },
        { value: 'CC-120', count: '2,880,102' },
        { value: 'CC-210', count: '2,104,450' },
      ],
      distribution: [
        { label: 'CC-330', value: '29%' },
        { label: 'CC-120', value: '24%' },
        { label: 'CC-210', value: '18%' },
        { label: 'Other', value: '29%' },
      ],
    },
    AmountLocal: {
      metrics: [
        { label: 'Distinct Values', value: '2,418,902' },
        { label: 'Null Count', value: '12' },
        { label: 'Min Value', value: '-982,441.18' },
        { label: 'Max Value', value: '4,850,000.00' },
        { label: 'Average', value: '42,501.22' },
        { label: 'Sum', value: '1,820,441,903,284.17' },
      ],
      topValues: [
        { value: '0.00', count: '1,284,904' },
        { value: '1,200.50', count: '412,880' },
        { value: '24,500.00', count: '287,119' },
      ],
      distribution: [
        { label: '< 0', value: '18%' },
        { label: '0 - 10k', value: '46%' },
        { label: '10k - 100k', value: '28%' },
        { label: '> 100k', value: '8%' },
      ],
    },
    Currency: {
      metrics: [
        { label: 'Distinct Values', value: '27' },
        { label: 'Null Count', value: '0' },
      ],
      topValues: [
        { value: 'EUR', count: '18,042,900' },
        { value: 'USD', count: '14,812,004' },
        { value: 'GBP', count: '4,404,912' },
      ],
      distribution: [
        { label: 'EUR', value: '44%' },
        { label: 'USD', value: '36%' },
        { label: 'GBP', value: '11%' },
        { label: 'Other', value: '9%' },
      ],
    },
  };

  protected get selectedColumns(): PreviewColumn[] {
    return this.previewColumns.filter((column) => this.selectedColumnNames.has(column.name));
  }

  protected get selectedProfilerColumn(): PreviewColumn {
    return (
      this.previewColumns.find((column) => column.name === this.selectedProfilerColumnName) ??
      this.previewColumns[0]
    );
  }

  protected get selectedProfilerData(): ColumnProfile {
    return this.profilerData[this.selectedProfilerColumn.name];
  }

  protected get topValuesHeading(): string {
    if (this.selectedProfilerColumn.type === 'number') {
      return 'Top Values';
    }

    return 'Most Common Values';
  }

  protected get distributionHeading(): string {
    if (this.selectedProfilerColumn.type === 'date') {
      return 'Date Distribution';
    }

    if (this.selectedProfilerColumn.type === 'text') {
      return 'Frequency Distribution';
    }

    return 'Distribution';
  }

  protected isSelected(columnName: string): boolean {
    return this.selectedColumnNames.has(columnName);
  }

  protected isProfilerColumn(columnName: string): boolean {
    return this.selectedProfilerColumnName === columnName;
  }

  protected toggleColumn(columnName: string): void {
    if (this.selectedColumnNames.has(columnName)) {
      this.selectedColumnNames.delete(columnName);
      return;
    }

    this.selectedColumnNames.add(columnName);
  }

  protected selectProfilerColumn(columnName: string): void {
    this.selectedProfilerColumnName = columnName;
  }

  protected getTextValues(columnName: string): string[] {
    return this.selectedTextValues[columnName] ?? [];
  }

  protected getNumericRange(columnName: string): { min: string; max: string; start: number; end: number } {
    return this.numericRanges[columnName] ?? { min: '', max: '', start: 0, end: 100 };
  }

  protected getDateRange(columnName: string): { from: string; to: string } {
    return this.dateRanges[columnName] ?? { from: '', to: '' };
  }

  protected resetFilters(): void {
    this.selectedColumnNames.clear();
    this.selectedTextValues = {};
    this.numericRanges = {};
    this.dateRanges = {};
  }
}
