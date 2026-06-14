import { Component, inject, OnInit } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { AuthService } from "./services/auth.service";

@Component({
  selector: "app-root",
  imports: [RouterOutlet],
  templateUrl: "./app.html",
  styleUrl: "./app.scss",
})
export class App implements OnInit {
  private auth = inject(AuthService);

  async ngOnInit() {
    await this.auth.restore();
  }
}
