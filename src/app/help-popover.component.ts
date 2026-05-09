import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-help-popover',
  templateUrl: './help-popover.component.html',
  styleUrl: './help-popover.component.css',
})
export class HelpPopoverComponent {
  @Input({ required: true }) text!: string;
  @Input() label = 'More information';
  @Input() interactive = true;
}
