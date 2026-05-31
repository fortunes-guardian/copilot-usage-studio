import { Component, ElementRef, Input, ViewChild, inject } from '@angular/core';

@Component({
  selector: 'app-help-popover',
  templateUrl: './help-popover.component.html',
  styleUrl: './help-popover.component.css',
})
export class HelpPopoverComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  @ViewChild('panel') private panel?: ElementRef<HTMLElement>;

  @Input({ required: true }) text!: string;
  @Input() label = 'More information';
  @Input() interactive = true;

  protected panelLeft = 0;
  protected panelTop = 0;
  protected panelWidth = 320;

  protected positionPanel(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const margin = 12;
    const maxWidth = Math.min(360, window.innerWidth - margin * 2);
    const rect = this.host.nativeElement.getBoundingClientRect();
    const panelRect = this.panel?.nativeElement.getBoundingClientRect();
    const measuredWidth = panelRect?.width && panelRect.width > 20 ? panelRect.width : maxWidth;
    const width = Math.min(maxWidth, measuredWidth);
    const idealLeft = rect.left + rect.width / 2 - width / 2;

    this.panelWidth = width;
    this.panelLeft = Math.min(window.innerWidth - margin - width, Math.max(margin, idealLeft));
    this.panelTop = Math.min(window.innerHeight - margin - 20, rect.bottom + 8);
  }
}


