import { Context, Service } from 'cordis';
import z from 'schemastery';
export interface WebhookConfig {
    url: string;
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    bodyTemplate: string;
}
export interface Config {
    enableMilestonePush: boolean;
    enableNewVideoPush: boolean;
    pushToBilibili: boolean;
    webhooks: WebhookConfig[];
}
export declare const Config: z<Config>;
export declare class PushService extends Service {
    config: Config;
    static inject: string[];
    constructor(ctx: Context, config: Config);
    protected start(): Promise<void>;
    private getUploaderName;
    private pushMilestone;
    private pushNewVideo;
    private pushToBilibiliDynamic;
    private dispatch;
}
export declare const apply: (ctx: Context, config: Config) => void;
