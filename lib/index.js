var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
import { Service } from "cordis";
import z from "schemastery";
var WebhookConfigSchema = z.object({
  url: z.string().required().description("Koishi Push 地址"),
  token: z.string().required().description("Koishi Push Bearer Token")
});
var Config = z.object({
  koishi: WebhookConfigSchema.description("Koishi 推送配置")
});
var PushService = class extends Service {
  constructor(ctx, config) {
    super(ctx, "lfvs.push");
    this.config = config;
    Promise.resolve().then(() => this.start().catch((e) => {
      this.ctx.emit("lfvs/log", "push", "error", `启动失败: ${e.message}`);
    }));
  }
  config;
  static {
    __name(this, "PushService");
  }
  static inject = ["database", "lfvs.core", "http", "logger"];
  async start() {
    this.ctx.on("lfvs/milestone-reached", async (video, milestone, oldStat, newStat) => {
      try {
        await this.pushMilestone(video, milestone, oldStat, newStat);
      } catch (e) {
        this.ctx.emit("lfvs/log", "push", "error", `推送里程碑失败: ${e.message}`);
      }
    });
  }
  async getUploaderName(uploaderId) {
    const res = await this.ctx.database.get("lfvs_uploader", { id: uploaderId });
    return res[0]?.name || "未知UP主";
  }
  async pushMilestone(video, milestone, oldStat, newStat) {
    const uploaderName = await this.getUploaderName(video.uploaderId);
    const formattedMilestone = milestone >= 1e4 ? `${milestone / 1e4}万` : milestone.toString();
    let content = `🎉 恭喜！
`;
    content += `视频：${video.title}
`;
    content += `所属：${uploaderName} (${video.platform})
`;
    content += `播放量已突破 ${formattedMilestone}！

`;
    content += `当前数据：
`;
    content += `👁️ 播放：${newStat.view} (+${newStat.view - oldStat.view})
`;
    content += `👍 点赞：${newStat.like}
`;
    content += `⭐ 收藏：${newStat.favorite}
`;
    content += `币 硬币：${newStat.coin}
`;
    content += `💬 弹幕：${newStat.danmaku}

`;
    if (video.platform === "bilibili") {
      content += `https://www.bilibili.com/video/${video.videoId}`;
    } else if (video.platform === "youtube") {
      content += `https://www.youtube.com/watch?v=${video.videoId}`;
    }
    await this.dispatch(content);
  }
  async dispatch(content) {
    const { url, token } = this.config.koishi;
    const start = Date.now();
    try {
      await this.ctx.http.post(
        url,
        { message: content },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        }
      );
      this.ctx.emit("lfvs/api-request", "push", "koishi", url, true, Date.now() - start);
    } catch (e) {
      this.ctx.emit("lfvs/api-request", "push", "koishi", url, false, Date.now() - start, e.message);
    }
  }
};
var apply = /* @__PURE__ */ __name((ctx, config) => {
  ctx.plugin(PushService, config);
}, "apply");
export {
  Config,
  PushService,
  apply
};
