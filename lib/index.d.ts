import { Context, Service } from 'cordis';
import z from 'schemastery';
export interface WebhookConfig {
    url: string;
    token: string;
}
export interface Config {
    koishi: WebhookConfig;
}
export declare const Config: z<Config>;
export declare class PushService extends Service {
    config: Config;
    static inject: string[];
    constructor(ctx: Context, config: Config);
    protected start(): Promise<void>;
    private getUploaderName;
    private pushMilestone;
    private dispatch;
}
export declare const apply: (ctx: Context, config: Config) => void;
