import mongoose from 'mongoose';

const alertLogSchema = new mongoose.Schema(
  {
    incidentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Incident',
      required: [true, 'Incident ID is required'],
      index: true,
    },
    type: {
      type: String,
      enum: {
        values: ['OPENED', 'RESOLVED'],
        message: '{VALUE} is not a valid alert type',
      },
      required: [true, 'Alert type is required'],
    },
    channel: {
      type: String,
      required: [true, 'Alert channel is required'],
      trim: true,
      maxlength: [100, 'Channel name cannot exceed 100 characters'],
    },
    status: {
      type: String,
      enum: {
        values: ['SENT', 'FAILED'],
        message: '{VALUE} is not a valid alert status',
      },
      required: [true, 'Alert status is required'],
    },
    errorMessage: {
      type: String,
      trim: true,
      maxlength: [2000, 'Error message cannot exceed 2000 characters'],
      default: null,
    },
    sentAt: {
      type: Date,
      required: [true, 'Sent-at timestamp is required'],
      default: Date.now,
    },
    attempts: {
      type: Number,
      default: 0,
      min: [0, 'Attempts cannot be negative'],
    },
    attemptHistory: [
      {
        attempt: { type: Number, required: true },
        status: { type: String, enum: ['SENT', 'FAILED'], required: true },
        errorMessage: { type: String, default: null },
        attemptedAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Index for querying alert history by incident
alertLogSchema.index({ incidentId: 1, sentAt: -1 });

// Compound unique index: deduplicate alerts so only one alert per (incidentId, type, channel)
alertLogSchema.index(
  { incidentId: 1, type: 1, channel: 1 },
  { unique: true, name: 'unique_alert_per_incident_type_channel' }
);

const AlertLog = mongoose.model('AlertLog', alertLogSchema);

export default AlertLog;
