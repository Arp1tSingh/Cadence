import { expose } from 'comlink';
import type { StretchWorkerApi } from '@/types/audio';
import { stretchPcm } from '@/core/audio/wsola';

const api: StretchWorkerApi = {
  async stretch(request) {
    return stretchPcm(request.audio, { rate: request.rate });
  },
};

expose(api);
