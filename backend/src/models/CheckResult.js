import mongoose from 'mongoose';
import { env } from '../config/env.js';

const checkResultSchema = new mongoose.Schema(
  {
    monitorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Monitor',
      required: [true, 'Monitor ID is required'],
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: ['UP', 'DOWN'],
        message: '{VALUE} is not a valid check status',
      },
      required: [true, 'Check status is required'],
    },
    statusCode: {
      type: Number,
      min: [0, 'Status code cannot be negative'],
      default: null,
    },
    responseTimeMs: {
      type: Number,
      min: [0, 'Response time cannot be negative'],
      default: null,
    },
    errorMessage: {
      type: String,
      trim: true,
      maxlength: [2000, 'Error message cannot exceed 2000 characters'],
      default: null,
    },
    checkedAt: {
      type: Date,
      required: [true, 'Checked-at timestamp is required'],
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index: query check results for a monitor in reverse chronological order
checkResultSchema.index({ monitorId: 1, checkedAt: -1 });

// TTL index: automatically delete check results after retention period
// RETENTION_DAYS env var controls how many days of data to keep (default: 30)
const retentionSeconds = (env.RETENTION_DAYS ?? 30) * 24 * 60 * 60;
checkResultSchema.index({ checkedAt: 1 }, { expireAfterSeconds: retentionSeconds });

const CheckResult = mongoose.model('CheckResult', checkResultSchema);

export default CheckResult;
