import {Observable} from 'rxjs/Observable';
import {Operator} from 'rxjs/Operator';
import {Subscriber} from 'rxjs/Subscriber';
import {Subscription} from 'rxjs/Subscription';
import {async} from 'rxjs/scheduler/async';
import {PartialObserver} from 'rxjs/Observer';
import {Action} from 'rxjs/scheduler/Action';
import {Scheduler as SchedulerI} from 'rxjs/Scheduler';


export function rateLimit<T>(this: Observable<T>, count: number, timeWindow: number, emitAsap: boolean = false, scheduler: SchedulerI = async): Observable<T[]> {
  return this.lift(new RateLimitOperator(count, timeWindow, emitAsap, scheduler));
}

class RateLimitOperator<T> implements Operator<T, T[]> {
  constructor(private count: number, private timeWindow: number, private emitAsap: boolean, private scheduler: SchedulerI) {
  }

  call(subscriber: Subscriber<T[]>, source: any) {
    return source.subscribe(new RateLimitSubscriber(subscriber, this.count, this.timeWindow, this.emitAsap, this.scheduler));
  }
}

class RateLimitSubscriber<T> extends Subscriber<T> {
  private buffer: T[] = [];
  private scheduledAction: Subscription;
  private lastEmissionTime: number = null;

  constructor(destination: Subscriber<T[]>, private count: number, private timeWindow: number, private emitAsap: boolean, private scheduler: SchedulerI) {
    super(destination);
  }

  private emitScheduledBuffer(state: RateLimitScheduledState<T>): void {
    const {destination, count, timeWindow, buffer, clear, isStopped, storeLastEmissionTime, now, complete} = state;

    let chunk = buffer.splice(0, count);
    destination.next(chunk);

    if (isStopped() && buffer.length === 0) {
      complete();
      return;
    }

    storeLastEmissionTime(now());

    if (buffer.length === 0) {
      clear();
    } else {
      (<Action<RateLimitScheduledState<T>>>(<any>this)).schedule(state, timeWindow);
    }
  }

  private storeLastEmissionTime(now): void {
    this.lastEmissionTime = now;
  }

  private clearScheduledAction(): void {
    this.scheduledAction = null;
  }

  private checkStopped(): boolean {
    return this.isStopped;
  }

  private scheduleBufferEmission(time: number) {
    const {destination, count, timeWindow, buffer, scheduler} = this;

    const state: RateLimitScheduledState<T> = {
      timeWindow,
      count,
      destination,
      buffer,
      clear: this.clearScheduledAction.bind(this),
      isStopped: this.checkStopped.bind(this),
      storeLastEmissionTime: this.storeLastEmissionTime.bind(this),
      now: scheduler.now.bind(this),
      complete: this.doComplete.bind(this)
    };

    this.scheduledAction = scheduler.schedule(this.emitScheduledBuffer, time, state);
  }

  protected _next(value: T): void {
    const {lastEmissionTime, buffer, timeWindow} = this;
    const now = this.scheduler.now();

    if (this.emitAsap && buffer.length === 0) {
      if ((now - lastEmissionTime) >= timeWindow || lastEmissionTime === null) {
        this.destination.next([value]);
        this.lastEmissionTime = now;

        return;
      }
    }

    buffer.push(value);

    if (!this.scheduledAction) {
      let delay;

      if (this.emitAsap) {
        const timeSinceLastEmission = now - lastEmissionTime;
        delay = lastEmissionTime === null ? timeWindow : Math.min(timeWindow, lastEmissionTime + timeWindow - now);
      } else {
        delay = timeWindow;
      }

      this.scheduleBufferEmission(delay);
    }
  }

  private doComplete() {
    super._complete();
  }

  protected _complete() {
    if (this.buffer.length === 0) {
      this.doComplete();
    }
  }

}

type RateLimitScheduledState<T> = {
  timeWindow: number;
  count: number;
  destination: PartialObserver<T[]>;
  buffer: T[];
  clear: Function;
  isStopped: Function;
  storeLastEmissionTime: Function;
  now: Function;
  complete: Function;
}