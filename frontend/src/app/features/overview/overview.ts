import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';

@Component({
  selector: 'app-overview',
  imports: [MatIconModule, MatTableModule],
  templateUrl: './overview.html',
})
export class Overview {
  protected readonly metrics = [
    { label: 'Total Rows', value: '42,831,904', icon: 'format_list_numbered' },
    { label: 'Total Columns', value: '286', icon: 'view_column' },
    { label: 'Imported Files', value: '18', icon: 'upload_file' },
    { label: 'Dataset Size', value: '37.4 GB', icon: 'database' },
  ];

  protected readonly columns = [
    { name: 'CompanyCode', type: 'Text', distinct: '18', nulls: '0', quality: '100%' },
    { name: 'PostingDate', type: 'Date', distinct: '1,826', nulls: '0', quality: '100%' },
    { name: 'AmountLocal', type: 'Decimal', distinct: '2,418,902', nulls: '12', quality: '99.99%' },
    { name: 'AccountNumber', type: 'Text', distinct: '3,492', nulls: '0', quality: '100%' },
    { name: 'CostCenter', type: 'Text', distinct: '1,204', nulls: '84,219', quality: '98.72%' },
    { name: 'Currency', type: 'Text', distinct: '27', nulls: '0', quality: '100%' },
  ];

  protected readonly displayedColumns = ['name', 'type', 'distinct', 'nulls', 'quality'];

  protected readonly selectedColumn = {
    name: 'AmountLocal',
    type: 'Decimal',
    distinctValues: '2,418,902',
    nullCount: '12',
    min: '-982,441.18',
    max: '4,850,000.00',
    average: '42,501.22',
    sum: '1,820,441,903,284.17',
    topValues: [
      { value: '0.00', count: '1,284,904' },
      { value: '125.00', count: '412,880' },
      { value: '1,200.50', count: '287,119' },
    ],
    distribution: [
      { label: '< 0', value: '18%' },
      { label: '0 - 10k', value: '46%' },
      { label: '10k - 100k', value: '28%' },
      { label: '> 100k', value: '8%' },
    ],
  };
}
