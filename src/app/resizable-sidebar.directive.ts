import { Directive, ElementRef, HostBinding, HostListener, Input, OnDestroy, OnInit, inject } from '@angular/core';

@Directive({ selector: '[appResizableSidebar]' })
export class ResizableSidebarDirective implements OnInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private dragging = false;
  private width = 400;

  @Input('appResizableSidebar') storageKey = 'copilot-usage-studio.results-sidebar-width';
  @Input() resizableMin = 280;
  @Input() resizableMax = 760;
  @Input() resizableDefault = 400;

  @HostBinding('attr.role') readonly role = 'separator';
  @HostBinding('attr.aria-orientation') readonly orientation = 'vertical';
  @HostBinding('attr.aria-label') readonly label = 'Resize results sidebar';
  @HostBinding('attr.tabindex') readonly tabindex = 0;
  @HostBinding('attr.aria-valuemin') get ariaMin(): number { return this.resizableMin; }
  @HostBinding('attr.aria-valuemax') get ariaMax(): number { return this.availableMax(); }
  @HostBinding('attr.aria-valuenow') get ariaNow(): number { return Math.round(this.width); }

  ngOnInit(): void {
    this.width = this.readStoredWidth();
    this.applyWidth(this.width, false);
  }

  ngOnDestroy(): void { this.stopDragging(); }

  @HostListener('pointerdown', ['$event'])
  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.dragging = true;
    this.element.nativeElement.classList.add('dragging');
    globalThis.addEventListener('pointermove', this.onPointerMove);
    globalThis.addEventListener('pointerup', this.onPointerUp, { once: true });
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home'
      ? this.resizableMin
      : event.key === 'End'
        ? this.availableMax()
        : this.width + (event.key === 'ArrowRight' ? 24 : -24);
    this.applyWidth(next);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const parent = this.element.nativeElement.parentElement;
    if (parent) this.applyWidth(event.clientX - parent.getBoundingClientRect().left);
  };

  private readonly onPointerUp = (): void => this.stopDragging();

  private stopDragging(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.element.nativeElement.classList.remove('dragging');
    globalThis.removeEventListener('pointermove', this.onPointerMove);
  }

  private availableMax(): number {
    const parentWidth = this.element.nativeElement.parentElement?.clientWidth ?? this.resizableMax;
    return Math.max(this.resizableMin, Math.min(this.resizableMax, parentWidth - 320));
  }

  private applyWidth(value: number, persist = true): void {
    this.width = Math.max(this.resizableMin, Math.min(this.availableMax(), Number(value) || this.resizableDefault));
    this.element.nativeElement.parentElement?.style.setProperty('--results-sidebar-width', `${this.width}px`);
    if (persist) {
      try { globalThis.localStorage?.setItem(this.storageKey, String(Math.round(this.width))); } catch { /* optional */ }
    }
  }

  private readStoredWidth(): number {
    try { return Number(globalThis.localStorage?.getItem(this.storageKey)) || this.resizableDefault; }
    catch { return this.resizableDefault; }
  }
}
