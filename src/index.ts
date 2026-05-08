import { Context, Service } from 'cordis'
import z from 'schemastery'
import { LfvsVideo, LfvsVideoStat } from '../../lfvs-core/src/index'
import {} from '@cordisjs/plugin-http'
import FormData from 'form-data'

export interface WebhookConfig {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  bodyTemplate: string
}

export interface Config {
  enableMilestonePush: boolean
  enableNewVideoPush: boolean
  pushToBilibili: boolean
  webhooks: WebhookConfig[]
}

const WebhookConfigSchema = z.object({
  url: z.string().required().description('Webhook 地址'),
  method: z.union(['GET', 'POST']).default('POST').description('请求方法'),
  headers: z.dict(z.string()).default({}).description('自定义请求头'),
  bodyTemplate: z.string().role('textarea').default('{"content": "{{content}}"}').description('请求正文模板。支持 {{content}} 占位符自动替换为通知文本')
})

export const Config: z<Config> = z.object({
  enableMilestonePush: z.boolean().default(true).description('当视频达到新的播放量里程碑时，是否自动发送动态'),
  enableNewVideoPush: z.boolean().default(true).description('当发现 UP主发布新视频时，是否自动发送动态'),
  pushToBilibili: z.boolean().default(true).description('是否允许将通知作为动态发布到 B站 (需要 B站适配器在线并提供认证信息)'),
  webhooks: z.array(WebhookConfigSchema).default([]).description('自定义 Webhook 推送列表')
})

export class PushService extends Service {
  static inject = ['database', 'lfvs.core', 'http', 'logger']

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'lfvs.push', true)
    Promise.resolve().then(() => this.start())
  }

  protected async start() {
    this.ctx.on('lfvs/milestone-reached', async (video: LfvsVideo, milestone: number, newStat: LfvsVideoStat) => {
      if (!this.config.enableMilestonePush) return
      await this.pushMilestone(video, milestone, newStat)
    })

    this.ctx.on('lfvs/new-video-found', async (video: LfvsVideo) => {
      if (!this.config.enableNewVideoPush) return
      await this.pushNewVideo(video)
    })
  }

  private async getUploaderName(uploaderId: number) {
    const res = await this.ctx.database.get('lfvs_uploader', { id: uploaderId })
    return res[0]?.name || '未知UP主'
  }

  private async pushMilestone(video: LfvsVideo, milestone: number, newStat: LfvsVideoStat) {
    const uploaderName = await this.getUploaderName(video.uploaderId)
    const formattedMilestone = milestone >= 10000 ? `${milestone / 10000}万` : milestone.toString()
    
    let content = `🎉 恭喜！\n`
    content += `视频：${video.title}\n`
    content += `所属：${uploaderName} (${video.platform})\n`
    content += `播放量已突破 ${formattedMilestone}！\n\n`
    content += `当前数据：\n`
    content += `👁️ 播放：${newStat.view}\n`
    content += `👍 点赞：${newStat.like}\n`
    content += `⭐ 收藏：${newStat.favorite}\n`
    content += `币 硬币：${newStat.coin}\n`
    content += `💬 弹幕：${newStat.danmaku}\n\n`
    
    if (video.platform === 'bilibili') {
      content += `https://www.bilibili.com/video/${video.videoId}`
    } else if (video.platform === 'youtube') {
      content += `https://www.youtube.com/watch?v=${video.videoId}`
    }

    await this.dispatch(content)
  }

  private async pushNewVideo(video: LfvsVideo) {
    const uploaderName = await this.getUploaderName(video.uploaderId)
    let content = `🆕 发现新视频发布！\n`
    content += `标题：${video.title}\n`
    content += `作者：${uploaderName} (${video.platform})\n\n`
    
    if (video.platform === 'bilibili') {
      content += `https://www.bilibili.com/video/${video.videoId}`
    } else if (video.platform === 'youtube') {
      content += `https://www.youtube.com/watch?v=${video.videoId}`
    }

    await this.dispatch(content)
  }

  private async pushToBilibiliDynamic(content: string) {
    const adapter = this.ctx.get('lfvs.core').getAdapter('bilibili')
    if (!adapter) {
      this.ctx.emit('lfvs/api-request', 'push', 'bilibili-dynamic', '', false, 0, 'Bilibili adapter not online')
      return false
    }

    const creds = await adapter.getCredentials()
    if (!creds || !creds.cookie || !creds.csrf) {
      this.ctx.emit('lfvs/api-request', 'push', 'bilibili-dynamic', '', false, 0, 'Bilibili credentials not available')
      return false
    }

    const start = Date.now()
    try {
      const form = new FormData()
      form.append('dynamic_id', '0')
      form.append('type', '4')
      form.append('rid', '0')
      form.append('content', content)
      form.append('csrf_token', creds.csrf)
      form.append('csrf', creds.csrf)
      form.append('ctrl', '[]')
      form.append('at_uids', '')
      
      const res = await this.ctx.http.post('https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/create', form, {
        headers: { ...form.getHeaders(), Cookie: creds.cookie, Origin: 'https://t.bilibili.com', Referer: 'https://t.bilibili.com/' }
      })

      const success = res.code === 0
      this.ctx.emit('lfvs/api-request', 'push', 'bilibili-dynamic', '', success, Date.now() - start, success ? undefined : res.message)
      return success
    } catch (e: any) {
      this.ctx.emit('lfvs/api-request', 'push', 'bilibili-dynamic', '', false, Date.now() - start, e.message)
      return false
    }
  }

  private async dispatch(content: string) {
    if (this.config.pushToBilibili) {
      await this.pushToBilibiliDynamic(content)
    }

    for (const hook of this.config.webhooks) {
      if (!hook.url) continue
      const start = Date.now()
      try {
        const bodyStr = hook.bodyTemplate.replace(/\{\{content\}\}/g, content)
        
        if (hook.method === 'POST') {
          let data: any = bodyStr
          try {
            data = JSON.parse(bodyStr)
          } catch (e) {}
          await this.ctx.http.post(hook.url, data, { headers: hook.headers })
        } else {
          await this.ctx.http.get(hook.url, { headers: hook.headers })
        }
        
        this.ctx.emit('lfvs/api-request', 'push', 'webhook', hook.url, true, Date.now() - start)
      } catch (e: any) {
        this.ctx.emit('lfvs/api-request', 'push', 'webhook', hook.url, false, Date.now() - start, e.message)
      }
    }
  }
}

export const apply = (ctx: Context, config: Config) => {
  ctx.plugin(PushService, config)
}
