import { Component } from "@angular/core";

@Component({
  selector: "app-sidebar",
  template: `
    <aside class="sidebar">
      <h6>Sports</h6>
      <ul>
        <li><i class="fa fa-baseball-ball text-success me-2"></i>Cricket</li>
        <li><i class="fa fa-dice text-danger me-2"></i>Casino</li>
        <li><i class="fa fa-table-tennis text-warning me-2"></i>Tennis</li>
        <li><i class="fa fa-futbol text-primary me-2"></i>Soccer</li>
        <li><i class="fa fa-horse text-info me-2"></i>Horse Racing</li>
        <li><i class="fa fa-basketball-ball text-warning me-2"></i>Basketball</li>
        <li><i class="fa fa-ticket-alt text-secondary me-2"></i>Lottery</li>
      </ul>
    </aside>
  `,
})
export class SidebarComponent {}
