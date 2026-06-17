import {} from '@cordisjs/plugin-database'
import { Context, Service } from 'cordis'
import z from 'schemastery'
import { LfvsVideo, LfvsVideoStat } from 'lfvs-core'
import {} from '@cordisjs/plugin-http'

export interface WebhookConfig {
  url: string
  token: string
}

export interface Config {
  koishi: WebhookConfig
}

const WebhookConfigSchema = z.object({
  url: z.string().required().description('Koishi Push 地址'),
  token: z.string().required().description('Koishi Push Bearer Token')
})

export const Config: z<Config> = z.object({
  koishi: WebhookConfigSchema.description('Koishi 推送配置')
})

export class PushService extends Service {
  static inject = ['database', 'lfvs.core', 'http', 'logger']

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'lfvs.push')
    Promise.resolve().then(() => this.start().catch(e => {
      this.ctx.emit('lfvs/log', 'push', 'error', `启动失败: ${e.message}`)
    }))
  }

  protected async start() {
    this.ctx.on('lfvs/milestone-reached', async (video: LfvsVideo, milestone: number, oldStat: LfvsVideoStat, newStat: LfvsVideoStat) => {
      try {
        await this.pushMilestone(video, milestone, oldStat, newStat)
      } catch (e: any) {
        this.ctx.emit('lfvs/log', 'push', 'error', `推送里程碑失败: ${e.message}`)
      }
    })
  }

  private async getUploaderName(uploaderId: number) {
    const res = await this.ctx.database.get('lfvs_uploader', { id: uploaderId })
    return res[0]?.name || '未知UP主'
  }

  private async pushMilestone(video: LfvsVideo, milestone: number, oldStat: LfvsVideoStat, newStat: LfvsVideoStat) {
    const uploaderName = await this.getUploaderName(video.uploaderId)
    const formattedMilestone = milestone >= 10000 ? `${milestone / 10000}万` : milestone.toString()
    
    let content = `🎉 恭喜！\n`
    content += `视频：${video.title}\n`
    content += `所属：${uploaderName} (${video.platform})\n`
    content += `播放量已突破 ${formattedMilestone}！\n\n`
    content += `当前数据：\n`
    content += `👁️ 播放：${newStat.view} (+${newStat.view - oldStat.view})\n`
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

  private async dispatch(content: string) {
    const { url, token } = this.config.koishi
    const start = Date.now()
    try {
      await this.ctx.http.post(
        url,
        { message: content },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      )
      this.ctx.emit('lfvs/api-request', 'push', 'koishi', url, true, Date.now() - start)
    } catch (e: any) {
      this.ctx.emit('lfvs/api-request', 'push', 'koishi', url, false, Date.now() - start, e.message)
    }
  }
}

export const apply = (ctx: Context, config: Config) => {
  ctx.plugin(PushService, config)
}
