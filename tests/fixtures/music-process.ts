import { ProjectStore } from "../../apps/server/src/store";
import { MusicService } from "../../apps/server/src/music-service";
const [directory, projectId, jobId] = process.argv.slice(2);
const keepAlive = setInterval(() => {}, 1000);
const service = new MusicService(
  new ProjectStore(directory),
  () => ({
    baseUrl: "https://api.kie.ai",
    apiKey: "synthetic-key",
    model: "V6",
  }),
  {
    submit: async () => {
      process.stdout.write("SUBMIT_ENTERED\n");
      return new Promise(() => {});
    },
    poll: async () => {
      throw new Error("Unexpected poll");
    },
    download: async () => {
      throw new Error("Unexpected download");
    },
  },
);
await service.approve(projectId, jobId);
await service.waitForIdle(projectId, jobId);
clearInterval(keepAlive);
