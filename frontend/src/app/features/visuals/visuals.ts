import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-visuals',
  imports: [MatIconModule],
  templateUrl: './visuals.html',
})
export class Visuals {
  protected readonly charts = [
    { title: 'Bar Chart', icon: 'bar_chart' },
    { title: 'Pie Chart', icon: 'pie_chart' },
    { title: 'Line Chart', icon: 'show_chart' },
  ];
}
