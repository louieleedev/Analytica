import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';

import { ProjectSelection } from '../../core/project-selection';

type ProjectNavItem = {
  label: string;
  icon: string;
  route: string;
};

@Component({
  selector: 'app-shell',
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    MatIconModule,
    MatListModule,
    MatSidenavModule,
    MatToolbarModule,
  ],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShell {
  protected readonly projectSelection = inject(ProjectSelection);

  protected readonly projectNavItems: ProjectNavItem[] = [
    { label: 'Overview', icon: 'dashboard', route: '/project/overview' },
    { label: 'Datasets', icon: 'table_view', route: '/project/datasets' },
    { label: 'Explorer', icon: 'travel_explore', route: '/project/explorer' },
    { label: 'Pivot', icon: 'pivot_table_chart', route: '/project/pivot' },
    { label: 'Visuals', icon: 'bar_chart', route: '/project/visuals' },
    { label: 'Reports', icon: 'description', route: '/project/reports' },
  ];
}
