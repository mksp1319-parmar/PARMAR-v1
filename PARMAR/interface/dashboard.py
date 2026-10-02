"""Interactive terminal dashboard for the PARMAR pipeline."""

from __future__ import annotations

from typing import Any

from PARMAR.audit.decision_logs import DecisionLogManager
from PARMAR.core.conflict.conflict_detector import ConflictDetector
from PARMAR.core.decision.decision_engine import DecisionEngine
from PARMAR.core.intent.intent_engine import IntentEngine
from PARMAR.core.mediation.mediation_engine import MediationEngine
from PARMAR.core.risk.risk_engine import RiskEngine
from PARMAR.phone.phone_awareness import PhoneAwarenessModule
from PARMAR.safety.autonomy_check import AutonomyCheck
from PARMAR.safety.emergency_gate import EmergencyGate
from PARMAR.safety.enforcement_gate import ActionBoundary, CentralEnforcementGate, EnforcementState
from PARMAR.safety.privacy_check import PrivacyCheck
from PARMAR.state import LifecycleState, LifecycleStateMachine, StateSnapshot


class TerminalDashboard:
    """Display the interactive PARMAR status panel and approval flow."""

    def __init__(self):
        self.logger = DecisionLogManager()
        self.phone_module = PhoneAwarenessModule()
        self.phone_awareness_enabled = True
        self.state_machine = LifecycleStateMachine()
        self._lifecycle_snapshot = self.state_machine.snapshot

    @property
    def lifecycle_snapshot(self) -> StateSnapshot:
        """Return the current request state or its last terminal snapshot after reset."""
        current_snapshot = self.state_machine.snapshot
        if current_snapshot.current_state is not LifecycleState.IDLE:
            return current_snapshot
        return self._lifecycle_snapshot

    def set_phone_awareness_enabled(self, enabled: bool) -> bool:
        self.phone_awareness_enabled = bool(enabled)
        if enabled:
            self.phone_module.grant_permission("phone_awareness")
            self.logger.log_event("permission_toggle", {
                "event": "phone_awareness_enabled",
                "status": "ENABLED",
                "reason": "User enabled the simulated phone-awareness permission.",
            })
        else:
            self.phone_module.revoke_permission("phone_awareness")
            self.logger.log_event("permission_toggle", {
                "event": "phone_awareness_disabled",
                "status": "DISABLED",
                "reason": "User disabled the simulated phone-awareness permission.",
            })
        return self.phone_awareness_enabled

    def reject_phone_event(self, event_name: str) -> dict:
        blocked = {
            "event_type": event_name,
            "source": "simulated",
            "timestamp": "simulated",
            "permission_required": True,
            "permission_granted": False,
            "data_collected": [],
            "risk_level": "LOW",
            "status": "PHONE AWARENESS DISABLED",
            "explanation": "PHONE AWARENESS DISABLED. PARMAR rejected the phone event before processing.",
            "recommendation": "Enable Phone Awareness Permission to allow simulated phone events to enter the PARMAR pipeline.",
            "human_decision": "REJECTED - PHONE AWARENESS DISABLED",
        }
        self.logger.log_event("phone_event_rejected", {
            "event": event_name,
            "risk_level": "LOW",
            "human_decision": "REJECTED - PHONE AWARENESS DISABLED",
            "reason": "Phone Awareness Permission was disabled.",
        })
        return blocked

    def _status_label(self, risk_level: str) -> str:
        level = str(risk_level).upper()
        if level in {"LOW"}:
            return "SAFE"
        if level in {"MEDIUM", "HIGH"}:
            return "REVIEW REQUIRED"
        return "BLOCKED"

    def run_pipeline(self, request_text: str, human_interests: list[str] | None = None, rules: list[str] | None = None) -> dict:
        self.state_machine.transition(LifecycleState.LISTENING, reset_context=True)
        self.state_machine.transition(LifecycleState.THINKING)
        self.state_machine.transition(LifecycleState.ANALYZING)

        intent = IntentEngine().analyze_request(request_text)
        risk = RiskEngine().evaluate(request_text)
        conflict = ConflictDetector().detect(request_text, human_interests or [], rules or [])
        mediation = MediationEngine().generate_alternatives(conflict["reasons"], risk["risk_level"], intent["intent"])

        self.state_machine.transition(
            LifecycleState.RISK_CHECK,
            risk_level=risk["risk_level"],
            intent=intent["intent"],
        )
        privacy = PrivacyCheck().evaluate(request_text)
        autonomy = AutonomyCheck().evaluate(request_text)
        emergency = EmergencyGate().evaluate(request_text, risk["risk_level"])

        decision = DecisionEngine().build_decision(
            goal="Review the request with human-centered risk controls",
            action=request_text,
            expected_benefit="A safer, compliant, and reviewed proposal",
            required_data=["request summary", "risk indicators", "human rules"],
            required_permissions=["Human approval", "policy review"],
            possible_consequences=["Privacy exposure", "Autonomy loss", "Operational disruption"],
            risk_level=risk["risk_level"],
            safety_checks=["privacy_check", "autonomy_check", "emergency_gate"],
            detected_intent=intent["intent"],
            detected_conflicts=conflict["reasons"],
            recommendation=mediation["alternatives"][0]["message"] if mediation.get("alternatives") else "Review the proposal with a human before acting.",
            human_approval_status="PENDING HUMAN APPROVAL" if risk["risk_level"] in {"medium", "high", "critical"} else "NO HUMAN APPROVAL REQUIRED",
        )

        decision["approval_message"] = (
            "HUMAN APPROVAL REQUIRED. The proposal cannot be approved automatically and must be confirmed by a human decision-maker."
            if risk["risk_level"] in {"medium", "high", "critical"}
            else "Low-risk request remains safe for review without automatic action."
        )
        decision["requires_human_approval"] = risk["risk_level"] in {"medium", "high", "critical"}

        summary = {
            "intent": intent,
            "risk": risk,
            "conflict": conflict,
            "mediation": mediation,
            "privacy": privacy,
            "autonomy": autonomy,
            "emergency_gate": emergency,
            "decision": decision,
            "status_label": self._status_label(risk["risk_level"]),
        }

        summary["enforcement"] = CentralEnforcementGate().evaluate_decision(
            {
                "risk": risk,
                "decision": decision,
                "requires_human_approval": decision.get("requires_human_approval", risk["risk_level"] in {"medium", "high", "critical"}),
            },
            privacy_result=privacy,
            autonomy_result=autonomy,
            emergency_result=emergency,
            human_approval=decision.get("human_approval_status", "PENDING HUMAN APPROVAL"),
        )
        summary["action_boundary"] = ActionBoundary().evaluate(summary["enforcement"])

        self.logger.log_event("proposal_review", {
            "request_text": request_text,
            "intent": intent["intent"],
            "risk_level": risk["risk_level"],
            "safety_status": emergency["status"],
            "approval_status": decision["human_approval_status"],
        })

        self._apply_enforcement_lifecycle(summary["enforcement"], response_completed=True)
        self._return_terminal_lifecycle_to_idle()
        return summary

    def _apply_enforcement_lifecycle(self, enforcement_result: dict, *, response_completed: bool) -> None:
        if self.state_machine.snapshot.current_state not in {
            LifecycleState.RISK_CHECK,
            LifecycleState.WAITING_FOR_HUMAN,
        }:
            return

        status = enforcement_result.get("status") or enforcement_result.get("state")
        if status == EnforcementState.HUMAN_APPROVAL_REQUIRED and self.state_machine.snapshot.current_state is LifecycleState.WAITING_FOR_HUMAN:
            return
        if status not in {
            EnforcementState.BLOCKED,
            EnforcementState.REJECTED,
            EnforcementState.HUMAN_APPROVAL_REQUIRED,
            EnforcementState.READY_FOR_ACTION,
            EnforcementState.APPROVED,
        }:
            return
        if status in {EnforcementState.READY_FOR_ACTION, EnforcementState.APPROVED} and enforcement_result.get("execution_allowed") is not True:
            return

        self._lifecycle_snapshot = self.state_machine.apply_enforcement_result(
            enforcement_result,
            response_completed=response_completed,
            risk_level=self.state_machine.snapshot.risk_level,
            intent=self.state_machine.snapshot.intent,
        )

    def _return_terminal_lifecycle_to_idle(self) -> None:
        if self.state_machine.snapshot.current_state in {LifecycleState.SAFE_RESPONSE, LifecycleState.BLOCKED}:
            self._lifecycle_snapshot = self.state_machine.snapshot
            self.state_machine.transition(LifecycleState.IDLE)

    def display_permission_status(self) -> None:
        state = "ENABLED" if self.phone_awareness_enabled else "DISABLED"
        print(f"Phone Awareness Permission: {state}")

    def display_status_panel(self, result: dict) -> None:
        status = result.get("status_label", "SAFE")
        print("\n=== PARMAR STATUS PANEL ===")
        print(f"Status: {status}")
        print(f"Intent: {result['intent']['intent']}")
        print(f"Risk Level: {result['risk']['risk_level']}")
        print(f"Detected Conflicts: {result['conflict']['reasons']}")
        print(f"Emergency Gate: {result['emergency_gate']['status']}")
        self.display_permission_status()

    def display_result(self, result: dict) -> None:
        print("\n=== PARMAR ANALYSIS ===")
        print(f"Detected intent: {result['intent']['intent']}")
        print(f"Proposed action: {result['intent']['requested_action']}")
        print(f"Risk level: {result['risk']['risk_level']}")
        print(f"Possible consequences: {result['risk']['reasons']}")
        print(f"Required permissions: {result['decision']['Required Permissions']}")
        print(f"Safety checks: {result['decision']['Safety Checks']}")
        print(f"Recommendation: {result['decision']['Recommendation']}")
        print(f"Human approval status: {result['decision']['human_approval_status']}")

    def display_approval_panel(self, result: dict) -> None:
        if not result["decision"].get("requires_human_approval", False):
            print("\n[SAFE] No human approval required for this low-risk action.")
            return
        print("\n=== HUMAN APPROVAL REQUIRED ===")
        print("[APPROVE]")
        print("[REJECT]")

    def handle_human_decision(self, result: dict, decision_value: str, reason: str = "") -> dict:
        normalized = str(decision_value).strip().lower()
        if normalized == "approve":
            result["decision"]["human_approval_status"] = "APPROVED"
            result["decision"]["approval_message"] = "APPROVED BY HUMAN. PARMAR did not execute anything without human approval."
            human_status = "APPROVED"
        elif normalized == "reject":
            result["decision"]["human_approval_status"] = "REJECTED"
            result["decision"]["approval_message"] = "REJECTED BY HUMAN. The action was not approved."
            human_status = "REJECTED"
        else:
            result["decision"]["human_approval_status"] = "PENDING HUMAN APPROVAL"
            result["decision"]["approval_message"] = "Unclear human response. The action remains pending human review."
            human_status = "PENDING HUMAN APPROVAL"

        result["enforcement"] = CentralEnforcementGate().evaluate_decision(
            {
                "risk": result.get("risk", {}),
                "decision": result["decision"],
                "requires_human_approval": result["decision"].get("requires_human_approval", False),
            },
            privacy_result=result.get("privacy"),
            autonomy_result=result.get("autonomy"),
            emergency_result=result.get("emergency_gate"),
            human_approval=human_status,
        )
        result["action_boundary"] = ActionBoundary().evaluate(result["enforcement"])

        self.logger.log_event("human_decision", {
            "request_text": result["intent"]["requested_action"],
            "risk_level": result["risk"]["risk_level"],
            "decision": human_status,
            "reason": reason or "No reason provided.",
        })
        outcome = {
            "human_decision": human_status,
            "decision": result["decision"],
            "enforcement": result["enforcement"],
            "action_boundary": result["action_boundary"],
        }
        if self.state_machine.snapshot.current_state is LifecycleState.WAITING_FOR_HUMAN:
            self._apply_enforcement_lifecycle(outcome["enforcement"], response_completed=True)
            self._return_terminal_lifecycle_to_idle()
        return outcome

    def run_phone_demo(self) -> dict:
        if not self.phone_awareness_enabled:
            print("\n[BLOCKED] PHONE AWARENESS DISABLED")
            rejected = self.reject_phone_event("battery_low")
            print(rejected)
            return rejected
        module = PhoneAwarenessModule()
        module.grant_permission("phone_awareness")
        demo_event = {
            "event_type": "battery_low",
            "source": "simulated",
            "timestamp": "2026-01-01T00:00:00Z",
            "permission_required": False,
            "permission_granted": True,
            "data_collected": ["battery_level"],
            "explanation": "Simulated battery status only. No private phone data is accessed.",
        }
        result = module.process_event(demo_event)
        print("\n=== PHONE AWARENESS DEMO ===")
        print(result)
        return result

    def run(self) -> None:
        print("PARMAR v1 — Predictive AI-Risk Mediation & Autonomous Reasoning")
        print("Commands: 'phone enable', 'phone disable', 'demo-phone', 'exit'")
        print("Phone Awareness Permission: ENABLED" if self.phone_awareness_enabled else "Phone Awareness Permission: DISABLED")
        while True:
            command = input("\nEnter a request, or use a dashboard command: ").strip()
            if command.lower() in {"", "exit", "quit"}:
                print("PARMAR session ended.")
                break

            if command.lower() in {"phone enable", "phone on"}:
                self.set_phone_awareness_enabled(True)
                print("[SAFE] Phone Awareness Permission: ENABLED")
                continue

            if command.lower() in {"phone disable", "phone off"}:
                self.set_phone_awareness_enabled(False)
                print("[BLOCKED] Phone Awareness Permission: DISABLED")
                continue

            if command.lower() == "demo-phone":
                self.run_phone_demo()
                continue

            if command.lower() in {"battery_low", "battery status", "notification", "signal strength", "screen_state"} and not self.phone_awareness_enabled:
                rejected = self.reject_phone_event(command.lower())
                print("\n[BLOCKED] PHONE AWARENESS DISABLED")
                print(rejected)
                continue

            result = self.run_pipeline(
                command,
                human_interests=["privacy", "autonomy", "safety"],
                rules=["No external sharing of personal data without approval", "Human agency must remain intact"],
            )
            self.display_status_panel(result)
            self.display_result(result)
            self.display_approval_panel(result)

            if result["decision"].get("requires_human_approval"):
                approval = input("HUMAN APPROVAL [APPROVE/REJECT]: ").strip().lower()
                if approval not in {"approve", "reject"}:
                    approval = "reject"
                outcome = self.handle_human_decision(result, approval, "Terminal dashboard human decision")
                print(f"Human decision recorded: {outcome['human_decision']}")
